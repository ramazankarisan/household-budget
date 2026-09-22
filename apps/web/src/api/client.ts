import {
  type AccountPayload,
  type ImportSummary,
  type TransactionPayload,
} from '@household-budget/core';

/**
 * Requests go to a relative path: in dev the Vite proxy forwards /api to the
 * Nest server, in production the two are served from the same origin. No API
 * base URL to configure either way.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);

  if (!response.ok) {
    throw await toFailure(response, path);
  }

  return (await response.json()) as T;
}

/**
 * A rejection the API stated as a machine code rather than a sentence. Nest returns the
 * object thrown with it — `{ code, columns }` — verbatim and adds no `message`, so the
 * code is what reaches the UI, and `src/i18n` is what words it.
 */
export class ApiError extends Error {
  readonly code: string;
  /** The missing column names, for `REQUIRED_COLUMN_MISSING`. */
  readonly columns: readonly string[];

  constructor(code: string, columns: readonly string[] = []) {
    super(columns.length > 0 ? `${code}: ${columns.join(', ')}` : code);
    this.name = 'ApiError';
    this.code = code;
    this.columns = columns;
  }
}

/**
 * Nest puts its own body on an error response, in one of two shapes: the object an
 * exception was constructed with, or `{ statusCode, error, message }` when it was given a
 * string. Surfacing both matters here: a rejected import says *why* —
 * `CSV_QUOTE_NOT_CLOSED`, or which column the header is missing.
 */
async function toFailure(response: Response, path: string): Promise<Error> {
  const fallback = new Error(`${path} failed: ${String(response.status)} ${response.statusText}`);

  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) {
      return fallback;
    }

    const coded = asApiError(body);
    if (coded !== undefined) {
      return coded;
    }

    const { message } = body as { message?: unknown };
    if (typeof message === 'string') {
      return new Error(message);
    }
    if (typeof message === 'object' && message !== null) {
      return asApiError(message) ?? fallback;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function asApiError(body: object): ApiError | undefined {
  const { code, columns } = body as { code?: unknown; columns?: unknown };
  if (typeof code !== 'string') {
    return undefined;
  }
  return new ApiError(
    code,
    Array.isArray(columns)
      ? columns.filter((column): column is string => typeof column === 'string')
      : [],
  );
}

export function listAccounts(signal?: AbortSignal): Promise<AccountPayload[]> {
  return request<AccountPayload[]>('/accounts', signal === undefined ? {} : { signal });
}

export function createAccount(iban: string, name: string): Promise<AccountPayload> {
  return request<AccountPayload>('/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ iban, name }),
  });
}

export function listTransactions(
  accountId: string,
  signal?: AbortSignal,
): Promise<TransactionPayload[]> {
  return request<TransactionPayload[]>(
    `/accounts/${encodeURIComponent(accountId)}/transactions`,
    signal === undefined ? {} : { signal },
  );
}

/** Multipart, because the API decodes the bytes — the browser must not guess an encoding. */
export function uploadImport(accountId: string, file: File): Promise<ImportSummary> {
  const form = new FormData();
  form.append('accountId', accountId);
  form.append('file', file);

  return request<ImportSummary>('/imports', { method: 'POST', body: form });
}
