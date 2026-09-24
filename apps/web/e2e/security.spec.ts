import { expect, test } from '@playwright/test';

/**
 * The loopback guard in the running stack, through the Vite proxy. The proxy rewrites
 * `Host` to its loopback target but forwards `Origin` untouched, so a foreign `Origin` here
 * reaches the API exactly as a cross-site form POST from another tab would.
 */
test.describe('loopback guard', () => {
  test('rejects a cross-site POST', async ({ request }) => {
    const response = await request.post('/api/rules/apply', {
      headers: { Origin: 'https://evil.com' },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN_ORIGIN' });
  });

  test('lets a same-machine GET through', async ({ request }) => {
    const response = await request.get('/api/accounts');

    expect(response.status()).toBe(200);
  });
});

/**
 * Multer's limits, which only exist in the running stack. The account need not exist:
 * multer rejects the form while parsing it, before the controller runs.
 */
test.describe('upload limits', () => {
  const csv = { name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\r\n') };

  test('rejects a form with more fields than the import takes', async ({ request }) => {
    const extra = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`extra${String(i)}`, 'x']),
    );

    const response = await request.post('/api/imports', {
      multipart: { accountId: 'acc', ...extra, file: csv },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects an oversized field value', async ({ request }) => {
    const response = await request.post('/api/imports', {
      multipart: { accountId: 'x'.repeat(2048), file: csv },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects a second file', async ({ request }) => {
    // FormData, because a plain object cannot carry the same field name twice.
    const form = new FormData();
    form.append('accountId', 'acc');
    for (const name of ['a.csv', 'b.csv']) {
      form.append('file', new Blob([csv.buffer], { type: csv.mimeType }), name);
    }

    const response = await request.post('/api/imports', { multipart: form });

    expect(response.status()).toBe(400);
  });

  test('still answers 413 to a file over 10 MB', async ({ request }) => {
    const response = await request.post('/api/imports', {
      multipart: { accountId: 'acc', file: { ...csv, buffer: Buffer.alloc(11 * 1024 * 1024) } },
    });

    expect(response.status()).toBe(413);
  });
});
