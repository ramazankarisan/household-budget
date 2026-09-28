import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from '../accounts/account.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from '../rules/category.service.js';
import { RuleService } from '../rules/rule.service.js';
import { ImportService } from './import.service.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(fixtures, name)));

/** Fixed, so the two-digit years in the fixtures resolve the same way on any day. */
const referenceYear = 2026;

let prisma: PrismaService;
let accounts: AccountService;
let imports: ImportService;
let categories: CategoryService;
let rules: RuleService;

beforeEach(async () => {
  if (prisma === undefined) {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AccountService, ImportService, CategoryService, RuleService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    accounts = moduleRef.get(AccountService);
    imports = moduleRef.get(ImportService);
    categories = moduleRef.get(CategoryService);
    rules = moduleRef.get(RuleService);
  }

  // Order matters: Transaction and Rule both hold a foreign key into Category, so
  // categories cannot go first.
  await prisma.transaction.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.account.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.category.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function account(iban = 'DE89370400440532013000'): Promise<string> {
  const created = await accounts.create(iban, 'Giro');
  return created.id;
}

function importFile(accountId: string, fixture: string) {
  return imports.importCsv({
    accountId,
    fileName: fixture,
    bytes: bytesOf(fixture),
    referenceYear,
  });
}

const liveRows = (accountId: string) =>
  prisma.transaction.findMany({
    where: { accountId, deletedAt: null },
    orderBy: { lineNumber: 'asc' },
  });

describe('ImportService.listBatches', () => {
  it('lists every upload, newest first, across accounts — a no-op one included', async () => {
    const giro = await account();
    const tagesgeld = await account('DE91100000000123456789');
    await importFile(giro, 'sparkasse-camt-18.csv');
    await importFile(tagesgeld, 'deutsche-bank.csv');
    await importFile(giro, 'sparkasse-camt-18.csv');

    const listed = await imports.listBatches();

    expect(listed.map((batch) => [batch.accountId, batch.fileName])).toEqual([
      [giro, 'sparkasse-camt-18.csv'],
      [tagesgeld, 'deutsche-bank.csv'],
      [giro, 'sparkasse-camt-18.csv'],
    ]);
    expect(listed[0]).toMatchObject({ rowsImported: 0, encoding: 'windows-1252' });
    expect(Number.isNaN(Date.parse(listed[0]?.importedAt ?? ''))).toBe(false);
  });
});

describe('ImportService', () => {
  it('imports the Windows-1252 fixture with umlauts intact', async () => {
    // The cp1252 assertion core's own tests cannot make: core has no TextDecoder.
    const accountId = await account();

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');
    const rows = await liveRows(accountId);

    expect(summary.encoding).toBe('windows-1252');
    expect(summary.parsed).toBe(9);
    expect(summary.imported).toBe(8);
    expect(summary.failed).toEqual([]);
    expect(rows.map((row) => row.counterpartyName)).toContain('Müller GmbH');
    expect(rows.find((row) => row.lineNumber === 6)?.purpose).toBe(
      'Miete Oktober\r\nHauptstraße 12',
    );
  });

  it('stores an imported row with no category and no lock', async () => {
    // The two columns the rules engine reads before it does anything. A row that arrived
    // pre-locked would be a row no rule could ever categorize.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const rows = await liveRows(accountId);

    expect(rows.every((row) => row.categoryId === null)).toBe(true);
    expect(rows.every((row) => row.categoryLockedAt === null)).toBe(true);
  });

  it('imports zero new rows on a re-import and reports the earlier batch', async () => {
    const accountId = await account();

    const first = await importFile(accountId, 'sparkasse-camt-18.csv');
    const second = await importFile(accountId, 'sparkasse-camt-18.csv');

    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(8);
    expect(second.duplicateOfBatchId).toBe(first.batchId);
    expect(first.duplicateOfBatchId).toBeUndefined();
  });

  it('keeps two genuinely identical rows apart, and keeps them apart on re-import', async () => {
    // Same day, same amount, same merchant, same purpose. A content hash alone
    // collapses these into one; the occurrence index is what prevents it.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const afterFirst = await liveRows(accountId);
    await importFile(accountId, 'sparkasse-camt-18.csv');
    const afterSecond = await liveRows(accountId);

    const rewe = (rows: { id: string; counterpartyName: string | null }[]) =>
      rows.filter((row) => row.counterpartyName === 'REWE SAGT DANKE; FILIALE 42');

    expect(rewe(afterFirst)).toHaveLength(2);
    expect(rewe(afterSecond)).toHaveLength(2);
    expect(new Set(rewe(afterSecond).map((row) => row.id)).size).toBe(2);
  });

  it('keeps exactly one pending row however often the same file is imported', async () => {
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    await importFile(accountId, 'sparkasse-camt-18.csv');
    await importFile(accountId, 'sparkasse-camt-18.csv');

    const pending = await prisma.transaction.findMany({ where: { accountId, status: 'pending' } });

    expect(pending).toHaveLength(1);
    expect(pending[0]?.dedupKey).toBeNull();
  });

  it('turns a pending row into exactly one booked row when the next export arrives', async () => {
    // The pending row comes back with a different Buchungstag and a rewritten purpose,
    // so no fingerprint could match it to its own booked form. Replacing the pending set
    // wholesale is what removes the "pending row and its booked twin" class of bug.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const summary = await importFile(accountId, 'sparkasse-camt-18-next.csv');
    const rows = await liveRows(accountId);

    const aerzte = rows.filter((row) => row.counterpartyName === 'Ärzte GmbH');

    expect(aerzte).toHaveLength(1);
    expect(aerzte[0]?.status).toBe('booked');
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
    expect(rows.some((row) => row.counterpartyName === 'Bäckerei Schmidt')).toBe(true);
    expect(summary.imported).toBe(2);
    expect(summary.skipped).toBe(3);
  });

  it('leaves the pending set alone when an older export is imported after a newer one', async () => {
    // The newest export owns the pending set; an older one saw a different day. Replacing
    // wholesale from a stale file would delete pending rows it never covered, and put back
    // the ones it still shows as pending — both of which the user would read as the bank
    // changing its mind.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18-next.csv');
    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');
    const rows = await liveRows(accountId);

    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
    expect(summary.pendingReplaced).toBe(0);
    // Its booked rows are a ledger and still import.
    expect(summary.imported).toBeGreaterThan(0);
  });

  it('replaces a pending row the next export dropped, even when its date is in the future', async () => {
    // A pending row carries the date the bank expects to book it, which for a standing
    // order is in the future. If that date counted as the account's high-water mark, every
    // export until then would look stale and the pending set would freeze — a standing
    // order the user cancelled would stay on screen, and stay in the budget.
    const accountId = await account();
    const header =
      'Auftragskonto;"Buchungstag";"Beguenstigter/Zahlungspflichtiger";' +
      '"Betrag";"Waehrung";"Info"';
    const booked = 'DE89370400440532013000;"20.09.25";"REWE";"-42,17";"EUR";"Umsatz gebucht"';
    const scheduled =
      'DE89370400440532013000;"30.09.25";"Vermieter";"-830,00";"EUR";"Umsatz vorgemerkt"';
    const later = 'DE89370400440532013000;"24.09.25";"Baeckerei";"-8,90";"EUR";"Umsatz gebucht"';

    const importText = (fileName: string, lines: readonly string[]) =>
      imports.importCsv({
        accountId,
        fileName,
        bytes: new TextEncoder().encode(`${[header, ...lines].join('\r\n')}\r\n`),
        referenceYear,
      });

    await importText('with-standing-order.csv', [booked, scheduled]);
    // The standing order is cancelled, so the next export simply stops listing it.
    const summary = await importText('after-cancellation.csv', [booked, later]);

    expect(await prisma.transaction.count({ where: { accountId, status: 'pending' } })).toBe(0);
    expect(summary.pendingReplaced).toBe(0);
  });

  it('brings a deleted transaction back on re-import instead of failing on the unique index', async () => {
    // The unique index covers soft-deleted rows, so a plain insert would raise P2002.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const before = await liveRows(accountId);
    const victim = before.find((row) => row.counterpartyName === 'Müller GmbH');
    await accounts.softDeleteTransaction(victim?.id ?? '');

    expect(await liveRows(accountId)).toHaveLength(before.length - 1);

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');

    expect(summary.restored).toBe(1);
    expect(summary.imported).toBe(0);
    expect(await liveRows(accountId)).toHaveLength(before.length);
  });

  it('brings a deleted pending row back too, as a new row rather than a restored one', async () => {
    // The booked path restores the stored row and keeps its id; the pending path cannot,
    // because the pending set is replaced wholesale and its rows carry no dedupKey to
    // match on. Both honour "delete locally, re-import, get it back" — this pins the one
    // way they differ, so a future reader does not read the missing restore as a bug.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const pendingRow = (await liveRows(accountId)).find((row) => row.status === 'pending');
    await accounts.softDeleteTransaction(pendingRow?.id ?? '');

    expect((await liveRows(accountId)).filter((row) => row.status === 'pending')).toHaveLength(0);

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');
    const live = (await liveRows(accountId)).filter((row) => row.status === 'pending');

    expect(live).toHaveLength(1);
    // A new row, not the restored one, and the soft-deleted original is gone for good.
    expect(live[0]?.id).not.toBe(pendingRow?.id);
    expect(summary.restored).toBe(0);
    expect(summary.pendingReplaced).toBe(1);
    expect(await prisma.transaction.count({ where: { id: pendingRow?.id ?? '' } })).toBe(0);
  });

  it('restores one of a duplicate pair without colliding with its twin', async () => {
    // Deleting the n:0 row and re-importing must restore that row, not insert a third
    // one under a key the surviving n:1 row already holds.
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const pair = (await liveRows(accountId)).filter(
      (row) => row.counterpartyName === 'REWE SAGT DANKE; FILIALE 42',
    );
    await accounts.softDeleteTransaction(pair[0]?.id ?? '');

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');
    const restored = (await liveRows(accountId)).filter(
      (row) => row.counterpartyName === 'REWE SAGT DANKE; FILIALE 42',
    );

    expect(summary.restored).toBe(1);
    expect(restored).toHaveLength(2);
    expect(restored.map((row) => row.id).sort()).toEqual(pair.map((row) => row.id).sort());
  });

  it('imports the good rows of a file with bad ones and reports the rest', async () => {
    const accountId = await account();

    const summary = await importFile(accountId, 'sparkasse-camt-18-bad-rows.csv');

    expect(summary.failed).toEqual([
      { code: 'AMOUNT_UNPARSEABLE', line: 3, field: 'Betrag', value: '12,3,4' },
      { code: 'DATE_UNPARSEABLE', line: 5, field: 'Buchungstag', value: '32.13.25' },
      { code: 'STATUS_UNKNOWN', line: 6, field: 'Info', value: 'Umsatz storniert' },
    ]);
    expect(summary.failedCount).toBe(3);
    expect(summary.imported).toBe(3);
    expect(await liveRows(accountId)).toHaveLength(3);
  });

  it('caps the reported row errors at 100 and keeps the true total', async () => {
    const accountId = await account();
    // The fixture's header plus its `12,3,4` row, 150 times over.
    const [header, , badAmount] = readFileSync(
      resolve(fixtures, 'sparkasse-camt-18-bad-rows.csv'),
      'utf-8',
    ).split('\r\n');
    const csv = [header, ...Array.from({ length: 150 }, () => badAmount), ''].join('\r\n');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const summary = await imports.importCsv({
      accountId,
      fileName: 'many-bad-rows.csv',
      bytes: new TextEncoder().encode(csv),
      referenceYear,
    });
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: summary.batchId } });

    expect(summary.failed).toHaveLength(100);
    expect(summary.failedCount).toBe(150);
    expect(batch.rowsFailed).toBe(150);
    // 100 row lines plus the one that says the rest were dropped.
    expect(warn).toHaveBeenCalledTimes(101);
    expect(warn).toHaveBeenLastCalledWith('import row errors capped: logged 100 of 150');
    warn.mockRestore();
  });

  it('rejects an unparseable file with a 4xx and imports nothing', async () => {
    const accountId = await account();

    await expect(importFile(accountId, 'sparkasse-camt-malformed.csv')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await liveRows(accountId)).toHaveLength(0);
    expect(await prisma.importBatch.count()).toBe(0);
  });

  it('rejects a file whose header is missing a required column', async () => {
    const accountId = await account();

    await expect(
      imports.importCsv({
        accountId,
        fileName: 'stumpf.csv',
        bytes: new TextEncoder().encode('Auftragskonto;"Buchungstag";"Betrag"\r\n'),
        referenceYear,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a file whose Auftragskonto is not the chosen account, and stores nothing', async () => {
    const accountId = await account('DE00000000000000000000');

    await expect(importFile(accountId, 'sparkasse-camt-18.csv')).rejects.toMatchObject({
      response: { code: 'ACCOUNT_IBAN_MISMATCH', columns: ['DE89…3000'] },
    });
    expect(await prisma.importBatch.count()).toBe(0);
    expect(await liveRows(accountId)).toHaveLength(0);
  });

  it('refuses a file where a single row names another Auftragskonto', async () => {
    const accountId = await account();
    const lines = new TextDecoder('windows-1252')
      .decode(bytesOf('sparkasse-camt-18.csv'))
      .split('\r\n');
    lines[1] = (lines[1] ?? '').replace('DE89370400440532013000', 'DE27100777770209299700');

    await expect(
      imports.importCsv({
        accountId,
        fileName: 'gemischt.csv',
        bytes: new TextEncoder().encode(lines.join('\r\n')),
        referenceYear,
      }),
    ).rejects.toMatchObject({
      response: { code: 'ACCOUNT_IBAN_MISMATCH', columns: ['DE27…9700'] },
    });
    expect(await liveRows(accountId)).toHaveLength(0);
  });

  it('records the batch with counts that add up', async () => {
    const accountId = await account();

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: summary.batchId } });

    expect(batch.encoding).toBe('windows-1252');
    expect(batch.dialect).toBe('sparkasse-camt');
    expect(summary.dialect).toBe('sparkasse-camt');
    expect(batch.fileName).toBe('sparkasse-camt-18.csv');
    expect(batch.fileHash).toHaveLength(64);
    expect(batch.rowsParsed).toBe(9);
    expect(batch.rowsImported).toBe(8);
    expect(batch.rowsFailed).toBe(0);
  });

  it('keeps the raw row so a re-key needs no re-download', async () => {
    const accountId = await account();

    await importFile(accountId, 'sparkasse-camt-18.csv');
    const row = (await liveRows(accountId))[0];

    expect(JSON.parse(row?.raw ?? '{}')).toMatchObject({ Betrag: '-832,9', Kategorie: 'Wohnen' });
  });
});

describe('ImportService, Deutsche Bank', () => {
  const OWN_IBAN = 'DE91100000000123456789';

  it('detects the format from the header and imports the file as the bank ships it', async () => {
    const accountId = await account(OWN_IBAN);

    const summary = await importFile(accountId, 'deutsche-bank.csv');
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: summary.batchId } });
    const rows = await liveRows(accountId);

    expect(summary).toMatchObject({
      dialect: 'deutsche-bank',
      encoding: 'utf-8',
      parsed: 8,
      imported: 8,
      failedCount: 0,
    });
    expect(batch.dialect).toBe('deutsche-bank');
    expect(rows.map((row) => row.lineNumber)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(rows.every((row) => row.accountIban === OWN_IBAN && row.status === 'booked')).toBe(true);
    expect(rows[0]).toMatchObject({ counterpartyName: 'Müller GmbH', amountCents: -83290 });
  });

  it('imports only what is new from an overlapping later export', async () => {
    const accountId = await account(OWN_IBAN);

    await importFile(accountId, 'deutsche-bank.csv');
    const summary = await importFile(accountId, 'deutsche-bank-next.csv');

    // Müller and the two identical card payments are already stored; the refund is new.
    expect(summary).toMatchObject({ parsed: 4, imported: 1, skipped: 3 });
    expect(await liveRows(accountId)).toHaveLength(9);
  });

  it('rejects the older export generation with HEADER_NOT_FOUND', async () => {
    const accountId = await account(OWN_IBAN);
    const older = new TextDecoder()
      .decode(bytesOf('deutsche-bank.csv'))
      .replace(';IBAN / Kontonummer;', ';IBAN;');

    await expect(
      imports.importCsv({
        accountId,
        fileName: 'alt.csv',
        bytes: new TextEncoder().encode(older),
        referenceYear,
      }),
    ).rejects.toMatchObject({ response: { code: 'HEADER_NOT_FOUND' } });
    expect(await prisma.importBatch.count()).toBe(0);
  });

  it('refuses a Deutsche Bank file in a Sparkasse account and keeps that account s pending row', async () => {
    const accountId = await account();
    await importFile(accountId, 'sparkasse-camt-18.csv');
    const before = await liveRows(accountId);

    await expect(importFile(accountId, 'deutsche-bank.csv')).rejects.toMatchObject({
      response: { code: 'ACCOUNT_IBAN_MISMATCH', columns: ['DE91…6789'] },
    });
    const after = await liveRows(accountId);

    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after.some((row) => row.status === 'pending')).toBe(true);
  });

  it('rejects a preamble that names no IBAN, naming the missing field', async () => {
    const accountId = await account(OWN_IBAN);

    await expect(importFile(accountId, 'deutsche-bank-no-iban.csv')).rejects.toMatchObject({
      response: { code: 'REQUIRED_COLUMN_MISSING', columns: ['IBAN'] },
    });
  });

  it('lists a batch stored before the dialect column existed as Sparkasse', async () => {
    const accountId = await account();
    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');
    await prisma.importBatch.update({ where: { id: summary.batchId }, data: { dialect: null } });

    const [listed] = await imports.listBatches();

    expect(listed?.dialect).toBe('sparkasse-camt');
  });
});

/**
 * The import's half of categorization. Separate describe, same database and the same
 * `beforeEach` truncation: these are about what an upload leaves behind, not about what
 * the engine decides.
 */
describe('ImportService.undo and restore', () => {
  it('hides every row the upload brought and keeps the upload listed as removed', async () => {
    const accountId = await account();
    const first = await importFile(accountId, 'sparkasse-camt-18.csv');
    const second = await importFile(accountId, 'sparkasse-camt-18-next.csv');

    const removed = await imports.undo(second.batchId);
    const rows = await liveRows(accountId);

    expect(removed.undoneAt).not.toBeNull();
    expect(rows.every((row) => row.importBatchId === first.batchId)).toBe(true);
    // Its booked rows only: the pending row was replaced by the newer export when it ran.
    expect(rows).toHaveLength(first.imported);
    const listed = await imports.listBatches();
    expect(listed.find((batch) => batch.id === second.batchId)?.undoneAt).toBe(removed.undoneAt);
  });

  it('brings back exactly the same rows on restore', async () => {
    const accountId = await account();
    const { batchId } = await importFile(accountId, 'sparkasse-camt-18.csv');
    const before = await liveRows(accountId);

    await imports.undo(batchId);
    const restored = await imports.restore(batchId);

    expect(restored.undoneAt).toBeNull();
    expect((await liveRows(accountId)).map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it('leaves a row deleted by hand before the removal deleted after a restore', async () => {
    const accountId = await account();
    const { batchId } = await importFile(accountId, 'sparkasse-camt-18.csv');
    const before = await liveRows(accountId);
    const [gone] = before;
    await accounts.softDeleteTransaction(gone?.id ?? '');

    await imports.undo(batchId);
    await imports.restore(batchId);
    const rows = await liveRows(accountId);

    expect(rows.map((row) => row.id)).not.toContain(gone?.id);
    expect(rows).toHaveLength(before.length - 1);
  });

  it('releases a hand-set category lock, as deleting a single row does', async () => {
    const accountId = await account();
    const { batchId } = await importFile(accountId, 'sparkasse-camt-18.csv');
    const wohnen = await categories.create('Wohnen');
    const [row] = await liveRows(accountId);
    await accounts.setTransactionCategory(row?.id ?? '', wohnen.id);

    await imports.undo(batchId);

    expect(await prisma.transaction.count({ where: { categoryLockedAt: { not: null } } })).toBe(0);
  });

  it('treats the file as new to the account once its upload is removed', async () => {
    const accountId = await account();
    const first = await importFile(accountId, 'sparkasse-camt-18.csv');
    await imports.undo(first.batchId);

    const again = await importFile(accountId, 'sparkasse-camt-18.csv');

    expect(again.duplicateOfBatchId).toBeUndefined();
    expect(again.restored).toBe(first.imported);
    expect(await liveRows(accountId)).toHaveLength(first.imported + first.pendingReplaced);
  });

  it('lets an upload stand again, and be removed again, once a re-import brings its rows back', async () => {
    const accountId = await account();
    const first = await importFile(accountId, 'sparkasse-camt-18.csv');
    await imports.undo(first.batchId);
    const again = await importFile(accountId, 'sparkasse-camt-18.csv');

    const listed = await imports.listBatches();
    expect(listed.find((batch) => batch.id === first.batchId)?.undoneAt).toBeNull();

    // Newest first: the re-import goes, then the upload that owns the booked rows.
    await imports.undo(again.batchId);
    await imports.undo(first.batchId);
    expect(await liveRows(accountId)).toHaveLength(0);
  });

  it('keeps the undo working when the same upload is removed twice at once', async () => {
    const accountId = await account();
    const { batchId } = await importFile(accountId, 'sparkasse-camt-18.csv');
    const before = await liveRows(accountId);

    const [one, two] = await Promise.all([imports.undo(batchId), imports.undo(batchId)]);
    await imports.restore(batchId);

    expect(one.undoneAt).toBe(two.undoneAt);
    expect((await liveRows(accountId)).map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it('removes only the newest standing upload, so a later overlapping file keeps its rows', async () => {
    const accountId = await account();
    const older = await importFile(accountId, 'sparkasse-camt-18.csv');
    const newer = await importFile(accountId, 'sparkasse-camt-18-next.csv');
    const before = await liveRows(accountId);

    await expect(imports.undo(older.batchId)).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_LATEST' },
    });
    expect(await liveRows(accountId)).toHaveLength(before.length);

    await imports.undo(newer.batchId);
    await expect(imports.undo(older.batchId)).resolves.toMatchObject({
      undoneAt: expect.any(String) as unknown,
    });
  });

  it('restores only the most recently removed upload of the account', async () => {
    const accountId = await account();
    const older = await importFile(accountId, 'sparkasse-camt-18.csv');
    const newer = await importFile(accountId, 'sparkasse-camt-18-next.csv');
    const before = await liveRows(accountId);
    await imports.undo(newer.batchId);
    await imports.undo(older.batchId);

    // The newer file skipped rows the older upload holds; alone, it would come back without them.
    await expect(imports.restore(newer.batchId)).rejects.toMatchObject({
      response: { code: 'IMPORT_RESTORE_BLOCKED' },
    });

    await imports.restore(older.batchId);
    await imports.restore(newer.batchId);
    expect((await liveRows(accountId)).map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });

  it('changes nothing when an upload is removed twice or restored while it stands', async () => {
    const accountId = await account();
    const { batchId } = await importFile(accountId, 'sparkasse-camt-18.csv');

    const standing = await imports.restore(batchId);
    const removed = await imports.undo(batchId);
    const again = await imports.undo(batchId);

    expect(standing.undoneAt).toBeNull();
    expect(again.undoneAt).toBe(removed.undoneAt);
    expect(await liveRows(accountId)).toHaveLength(0);
  });

  it('answers 404 for an upload that does not exist', async () => {
    await expect(imports.undo('missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(imports.restore('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ImportService and the rules engine', () => {
  async function wohnenRule(): Promise<string> {
    const wohnen = await categories.create('Wohnen');
    await rules.create({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'müller',
      priority: 10,
      categoryId: wohnen.id,
    });
    return wohnen.id;
  }

  const muellerRow = (accountId: string) =>
    prisma.transaction.findFirstOrThrow({
      where: { accountId, counterpartyName: 'Müller GmbH' },
    });

  it('categorizes the rows it just inserted, in the same request', async () => {
    // Otherwise every import is followed by a manual second step, forever.
    const wohnenId = await wohnenRule();
    const accountId = await account();

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');

    expect(summary.categorized).toBeGreaterThan(0);
    expect((await muellerRow(accountId)).categoryId).toBe(wohnenId);
  });

  it('reports zero categorized when no rule matches anything', async () => {
    const accountId = await account();

    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');

    expect(summary.categorized).toBe(0);
  });

  it('does not touch a hand-set category when the same file is imported again', async () => {
    const wohnenId = await wohnenRule();
    const accountId = await account();
    await importFile(accountId, 'sparkasse-camt-18.csv');
    const lebensmittel = await categories.create('Lebensmittel');
    const row = await muellerRow(accountId);
    await accounts.setTransactionCategory(row.id, lebensmittel.id);

    const second = await importFile(accountId, 'sparkasse-camt-18.csv');

    const after = await muellerRow(accountId);
    expect(second.imported).toBe(0);
    expect(second.categorized).toBe(0);
    expect(after.categoryId).toBe(lebensmittel.id);
    expect(after.categoryId).not.toBe(wohnenId);
    expect(after.categoryLockedAt).not.toBeNull();
  });

  it('does not bring back a category the rule behind it no longer explains', async () => {
    // A restored row is an old row: it can still hold a category a since-deleted rule
    // wrote. Letting that return would show a category the next apply silently strips.
    const accountId = await account();
    await wohnenRule();
    await importFile(accountId, 'sparkasse-camt-18.csv');
    const row = await muellerRow(accountId);
    expect(row.categoryId).not.toBeNull();

    await accounts.softDeleteTransaction(row.id);
    const rule = await prisma.rule.findFirstOrThrow();
    await prisma.rule.delete({ where: { id: rule.id } });
    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');

    const restored = await muellerRow(accountId);
    expect(summary.restored).toBe(1);
    expect(restored.id).toBe(row.id);
    expect(restored.categoryId).toBeNull();
  });

  it('categorizes both halves of a duplicate pair, and neither of them twice', async () => {
    // The two REWE rows are byte-identical: same day, same amount, same purpose. They are
    // one fingerprint told apart by an occurrence index, and an engine that walked
    // fingerprints rather than rows would categorize one and leave the other behind.
    const lebensmittel = await categories.create('Lebensmittel');
    await rules.create({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'rewe',
      categoryId: lebensmittel.id,
    });
    const accountId = await account();

    const first = await importFile(accountId, 'sparkasse-camt-18.csv');
    const second = await importFile(accountId, 'sparkasse-camt-18.csv');

    const rewe = (await liveRows(accountId)).filter(
      (transaction) => transaction.counterpartyName === 'REWE SAGT DANKE; FILIALE 42',
    );
    expect(rewe).toHaveLength(2);
    expect(rewe.every((transaction) => transaction.categoryId === lebensmittel.id)).toBe(true);
    expect(first.categorized).toBe(2);
    // Nothing new to insert the second time, so nothing to categorize either.
    expect(second.imported).toBe(0);
    expect(second.categorized).toBe(0);
  });

  it('categorizes a restored row, not only a newly inserted one', async () => {
    // The rule is written after the first import and the row is deleted before the
    // second, so the row has never been categorized when it comes back. A restore that
    // skipped the engine would return it as the one uncategorized row in the account.
    const accountId = await account();
    await importFile(accountId, 'sparkasse-camt-18.csv');
    const row = await muellerRow(accountId);
    expect(row.categoryId).toBeNull();

    await accounts.softDeleteTransaction(row.id);
    const wohnenId = await wohnenRule();
    const summary = await importFile(accountId, 'sparkasse-camt-18.csv');

    const restored = await muellerRow(accountId);
    expect(summary.restored).toBe(1);
    expect(summary.categorized).toBe(1);
    expect(restored.id).toBe(row.id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.categoryId).toBe(wohnenId);
  });
});
