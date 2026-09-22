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
    throw new Error(await describeFailure(response, path));
  }

  return (await response.json()) as T;
}

/**
 * Nest puts its own body on an error response. Surfacing it matters here: a rejected
 * import says *why* — `CSV_QUOTE_NOT_CLOSED`, or which column the header is missing.
 */
async function describeFailure(response: Response, path: string): Promise<string> {
  const fallback = `${path} failed: ${String(response.status)} ${response.statusText}`;

  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body as { message?: unknown };
      if (typeof message === 'string') {
        return message;
      }
      if (typeof message === 'object' && message !== null && 'code' in message) {
        return String((message as { code: unknown }).code);
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
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
