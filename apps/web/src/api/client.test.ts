import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, listAccounts, uploadImport } from './client';

/** Nest serialises a rejection as JSON; what varies is its shape, which is the point here. */
function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }),
    ),
  );
}

const csv = () => new File(['x'], 'export.csv', { type: 'text/csv' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request failures', () => {
  it('surfaces the code an import was rejected with', async () => {
    // `throw new BadRequestException({ code })` — Nest returns that object verbatim and
    // adds no `message`, so reading only `message` loses the one useful fact.
    respondWith(400, { code: 'CSV_QUOTE_NOT_CLOSED' });

    await expect(uploadImport('acc-1', csv())).rejects.toMatchObject({
      code: 'CSV_QUOTE_NOT_CLOSED',
      columns: [],
    });
  });

  it('carries the missing column names with the code', async () => {
    respondWith(400, { code: 'REQUIRED_COLUMN_MISSING', columns: ['Betrag'] });

    const failure = await uploadImport('acc-1', csv()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).columns).toEqual(['Betrag']);
    expect((failure as ApiError).message).toBe('REQUIRED_COLUMN_MISSING: Betrag');
  });

  it("uses Nest's own message when the exception was given a string", async () => {
    respondWith(400, { statusCode: 400, error: 'Bad Request', message: 'accountId is required' });

    await expect(uploadImport('', csv())).rejects.toThrowError('accountId is required');
  });

  it('falls back to the status line when the body says nothing useful', async () => {
    respondWith(500, {});

    await expect(listAccounts()).rejects.toThrowError('/accounts failed: 500');
  });
});
