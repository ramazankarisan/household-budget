import {
  type AccountPayload,
  type ApplySummary,
  type CategoryPayload,
  type ImportSummary,
  type RuleInput,
  type RulePayload,
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
  /**
   * The rest of the object the API threw, verbatim. `CATEGORY_IN_USE` carries the two
   * counts that explain the refusal; `RULE_INVALID` carries one entry per bad form field.
   * Kept untyped here because this layer's job is to hand it on, not to interpret it.
   */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    columns: readonly string[] = [],
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(columns.length > 0 ? `${code}: ${columns.join(', ')}` : code);
    this.name = 'ApiError';
    this.code = code;
    this.columns = columns;
    this.details = details;
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
    body as Record<string, unknown>,
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

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** 204 has no body, so these cannot go through `request`, which always parses one. */
async function remove(path: string): Promise<void> {
  const response = await fetch(`/api${path}`, { method: 'DELETE' });
  if (!response.ok) {
    throw await toFailure(response, path);
  }
}

export function listCategories(signal?: AbortSignal): Promise<CategoryPayload[]> {
  return request<CategoryPayload[]>('/categories', signal === undefined ? {} : { signal });
}

export function createCategory(name: string): Promise<CategoryPayload> {
  return request<CategoryPayload>('/categories', json('POST', { name }));
}

/** 409 while any rule or transaction still points at it — see `CATEGORY_IN_USE`. */
export function deleteCategory(categoryId: string): Promise<void> {
  return remove(`/categories/${encodeURIComponent(categoryId)}`);
}

export function listRules(signal?: AbortSignal): Promise<RulePayload[]> {
  return request<RulePayload[]>('/rules', signal === undefined ? {} : { signal });
}

export function createRule(input: RuleInput): Promise<RulePayload> {
  return request<RulePayload>('/rules', json('POST', input));
}

/** A whole rule, not a partial one: every field is on the form. */
export function updateRule(ruleId: string, input: RuleInput): Promise<RulePayload> {
  return request<RulePayload>(`/rules/${encodeURIComponent(ruleId)}`, json('PATCH', input));
}

export function deleteRule(ruleId: string): Promise<void> {
  return remove(`/rules/${encodeURIComponent(ruleId)}`);
}

/** No body: rules are global, so applying them is a global act. */
export function applyRules(): Promise<ApplySummary> {
  return request<ApplySummary>('/rules/apply', { method: 'POST' });
}

/** `null` clears the category and the lock, making the row eligible for the next apply. */
export function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<TransactionPayload> {
  return request<TransactionPayload>(
    `/transactions/${encodeURIComponent(transactionId)}`,
    json('PATCH', { categoryId }),
  );
}
