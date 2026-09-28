import {
  assignOccurrences,
  BankDialectId,
  CsvFileError,
  dedupKeyInput,
  fingerprintInput,
  ImportBatchPayload,
  ImportSummary,
  RowError,
  Transaction as ParsedTransaction,
} from '@household-budget/core';
import { detectDialect, parseBankCsv } from '@household-budget/core/csv';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AccountService } from '../accounts/account.service.js';
import { type ImportBatch } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RuleService } from '../rules/rule.service.js';
import { sanitizeForLog } from '../security/sanitize-log.js';
import { decodeBankCsv } from './decode.js';
import { dedupKeyHash, sha256Hex } from './hash.js';

export interface ImportRequest {
  readonly accountId: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /** Resolves two-digit years. Defaults to now; injected so tests are not time-dependent. */
  readonly referenceYear?: number;
}

/**
 * Row errors logged and returned per import. A malformed 10 MB file can fail on every one
 * of its rows; past this many the user has the pattern, and `failedCount` keeps the total
 * honest.
 */
const MAX_REPORTED_ROW_ERRORS = 100;

/** `DE89…3000` — enough to tell two accounts apart in a log, not enough to be one. */
function maskIban(iban: string): string {
  return iban.length <= 8 ? iban : `${iban.slice(0, 4)}…${iban.slice(-4)}`;
}

/**
 * csv-parse reports structural failures — an unterminated quote, a ragged row — with a
 * `CSV_`-prefixed code. Those are the file's fault, not the server's, so they belong in
 * a 4xx. Matched structurally rather than by importing csv-parse, which is
 * `packages/core`'s dependency and not this app's.
 */
function csvErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string' && code.startsWith('CSV_')) {
      return code;
    }
  }
  return undefined;
}

/**
 * A stored batch's dialect. Null predates the column, when Sparkasse CSV-CAMT was the only
 * format; anything else was written by `importCsv` from a registered id.
 */
function storedDialect(value: string | null): BankDialectId {
  return value === null ? 'sparkasse-camt' : (value as BankDialectId);
}

/** Uploads to the same account listed above this one: the order `listBatches` shows. */
function newerThan(batch: ImportBatch) {
  return {
    accountId: batch.accountId,
    OR: [
      { importedAt: { gt: batch.importedAt } },
      { importedAt: batch.importedAt, id: { gt: batch.id } },
    ],
  };
}

function toBatchPayload(batch: ImportBatch): ImportBatchPayload {
  return {
    id: batch.id,
    accountId: batch.accountId,
    fileName: batch.fileName,
    encoding: batch.encoding === 'utf-8' ? 'utf-8' : 'windows-1252',
    dialect: storedDialect(batch.dialect),
    importedAt: batch.importedAt.toISOString(),
    rowsParsed: batch.rowsParsed,
    rowsImported: batch.rowsImported,
    rowsSkipped: batch.rowsSkipped,
    rowsRestored: batch.rowsRestored,
    rowsFailed: batch.rowsFailed,
    undoneAt: batch.undoneAt?.toISOString() ?? null,
  };
}

type TransactionRow = {
  accountId: string;
  importBatchId: string;
  dedupKey: string | null;
  accountIban: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  status: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  counterpartyBic: string | null;
  purpose: string | null;
  bookingText: string | null;
  endToEndRef: string | null;
  mandateRef: string | null;
  creditorId: string | null;
  bankCategory: string | null;
  lineNumber: number;
  raw: string;
};

function toRow(
  transaction: ParsedTransaction,
  accountId: string,
  importBatchId: string,
  dedupKey: string | null,
): TransactionRow {
  return {
    accountId,
    importBatchId,
    dedupKey,
    accountIban: transaction.accountIban,
    bookingDate: transaction.bookingDate,
    valueDate: transaction.valueDate ?? null,
    amountCents: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    counterpartyName: transaction.counterpartyName ?? null,
    counterpartyIban: transaction.counterpartyIban ?? null,
    counterpartyBic: transaction.counterpartyBic ?? null,
    purpose: transaction.purpose ?? null,
    bookingText: transaction.bookingText ?? null,
    endToEndRef: transaction.endToEndRef ?? null,
    mandateRef: transaction.mandateRef ?? null,
    creditorId: transaction.creditorId ?? null,
    bankCategory: transaction.bankCategory ?? null,
    lineNumber: transaction.source.lineNumber,
    // Verbatim, so a change to how fields are normalized can re-key the stored rows
    // instead of asking the user to download every statement again.
    raw: JSON.stringify(transaction.source.raw),
  };
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly rules: RuleService,
  ) {}

  /** The most recent this many uploads are listed; older ones stay stored, unlisted. */
  static readonly HISTORY_LIMIT = 200;

  /**
   * Every upload, newest first, across every account — the answer to "did I import August
   * already?". A batch that brought no new rows is listed too: that is exactly the one
   * worth seeing.
   */
  async listBatches(): Promise<ImportBatchPayload[]> {
    const batches = await this.prisma.importBatch.findMany({
      orderBy: [{ importedAt: 'desc' }, { id: 'desc' }],
      take: ImportService.HISTORY_LIMIT,
    });
    return batches.map(toBatchPayload);
  }

  /**
   * Removes an upload: every row it inserted that is still live is soft-deleted, all with
   * one timestamp that the batch keeps as `undoneAt`. Soft, like deleting a single row, so
   * `restore` can put them back — and like a single row, the hand-set lock goes with it
   * (see `AccountService.softDeleteTransaction`). The batch stays listed, marked removed.
   *
   * Only the account's newest standing upload (`IMPORT_NOT_LATEST` otherwise). A row an
   * overlapping later export skipped as already stored still belongs to the older upload,
   * so removing the older one would take rows the later file holds. Newest first, like a
   * stack, never reaches such a row.
   *
   * Rows this upload restored rather than inserted belong to an older batch and stay. The
   * pending rows it replaced were deleted outright when it ran and do not come back; the
   * account's next export brings its pending set anew. Removing twice changes nothing.
   */
  async undo(batchId: string): Promise<ImportBatchPayload> {
    await this.requireBatch(batchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (batch.undoneAt !== null) {
        return batch;
      }
      const newer = await tx.importBatch.count({
        where: { ...newerThan(batch), undoneAt: null },
      });
      if (newer > 0) {
        throw new ConflictException({ code: 'IMPORT_NOT_LATEST' });
      }

      // Strictly after every earlier deletion in this batch: a row deleted by hand in the
      // same millisecond would otherwise share the timestamp, and `restore` would bring it
      // back with the rest.
      const { _max } = await tx.transaction.aggregate({
        where: { importBatchId: batchId },
        _max: { deletedAt: true },
      });
      const undoneAt = new Date(Math.max(Date.now(), (_max.deletedAt?.getTime() ?? 0) + 1));

      // Claimed by a conditional write, not by the read above: of two removals in flight,
      // exactly one sets `undoneAt`. The other would otherwise stamp a later time over it
      // and leave `restore` looking for rows deleted at a moment nothing was.
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, undoneAt: null },
        data: { undoneAt },
      });
      if (claimed.count === 1) {
        await tx.transaction.updateMany({
          where: { importBatchId: batchId, deletedAt: null },
          data: { deletedAt: undoneAt, categoryLockedAt: null },
        });
      }
      return tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    });
    this.logger.log(`import ${batchId} removed`);
    return toBatchPayload(updated);
  }

  /**
   * The undo for `undo`: brings back exactly the rows it deleted, found by the timestamp
   * they share with the batch. A row the user had deleted by hand before carries another
   * timestamp and stays deleted. Restoring a batch that stands changes nothing.
   *
   * Only the account's most recently removed upload (`IMPORT_RESTORE_BLOCKED` otherwise):
   * with B removed and then A under it, B's file skipped rows that A holds, and bringing B
   * back alone would leave them missing.
   */
  async restore(batchId: string): Promise<ImportBatchPayload> {
    await this.requireBatch(batchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      const { undoneAt } = batch;
      if (undoneAt === null) {
        return batch;
      }
      const later = await tx.importBatch.count({
        where: { accountId: batch.accountId, undoneAt: { gt: undoneAt } },
      });
      if (later > 0) {
        throw new ConflictException({ code: 'IMPORT_RESTORE_BLOCKED' });
      }

      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, undoneAt },
        data: { undoneAt: null },
      });
      if (claimed.count === 1) {
        await tx.transaction.updateMany({
          where: { importBatchId: batchId, deletedAt: undoneAt },
          data: { deletedAt: null },
        });
      }
      return tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    });
    this.logger.log(`import ${batchId} restored`);
    return toBatchPayload(updated);
  }

  private async requireBatch(batchId: string): Promise<ImportBatch> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (batch === null) {
      throw new NotFoundException(`No import ${batchId}`);
    }
    return batch;
  }

  async importCsv(request: ImportRequest): Promise<ImportSummary> {
    const account = await this.accounts.requireAccount(request.accountId);
    const fileHash = sha256Hex(request.bytes);

    // A removed upload is not one the user still has: this file is new to the account again.
    const priorBatch = await this.prisma.importBatch.findFirst({
      where: { accountId: account.id, fileHash, undoneAt: null },
      orderBy: { importedAt: 'asc' },
      select: { id: true },
    });

    const { text, encoding } = decodeBankCsv(request.bytes);
    this.logger.log(
      `import account=${maskIban(account.iban)} file="${sanitizeForLog(request.fileName)}" encoding=${encoding}`,
    );

    const { dialect, transactions, errors } = this.parse(text, request, encoding);
    this.requireOwnIban(account.iban, transactions);

    const booked = transactions.filter((transaction) => transaction.status === 'booked');
    const pending = transactions.filter((transaction) => transaction.status === 'pending');
    this.logger.log(
      `import dialect=${dialect} parsed=${String(transactions.length)} booked=${String(booked.length)} ` +
        `pending=${String(pending.length)} errors=${String(errors.length)}`,
    );
    const reported = errors.slice(0, MAX_REPORTED_ROW_ERRORS);
    for (const error of reported) {
      this.logRowError(error);
    }
    if (reported.length < errors.length) {
      this.logger.warn(
        `import row errors capped: logged ${String(reported.length)} of ${String(errors.length)}`,
      );
    }

    const dedupKeys = this.dedupKeysFor(booked);
    const { toInsert, toRestore, skipped } = await this.classify(account.id, dedupKeys);
    const stale = await this.isStaleExport(account.id, booked);
    const pendingToStore = stale ? [] : pending;

    const { batchId, categorized } = await this.prisma.$transaction(async (tx) => {
      // Pending rows are a snapshot, not a ledger: the newest export is always right,
      // so the stored set is replaced wholesale rather than reconciled. Inside the
      // transaction, so a crash cannot leave them deleted but not reinserted. An older
      // export is not the newest anything, so it replaces nothing.
      //
      // Deliberately unfiltered by `deletedAt`: a pending row the user deleted is removed
      // with the rest and comes back as a *new* row when the file still lists it, where a
      // deleted booked row is restored in place and keeps its id. Both honour "delete
      // locally, re-import, get it back"; only pending cannot keep the id, because it
      // carries no dedupKey to match the incoming row against.
      if (!stale) {
        await tx.transaction.deleteMany({
          where: { accountId: account.id, status: 'pending' },
        });
      }

      const batch = await tx.importBatch.create({
        data: {
          accountId: account.id,
          fileName: request.fileName,
          fileHash,
          encoding,
          dialect,
          rowsParsed: transactions.length,
          rowsImported: toInsert.length,
          rowsSkipped: skipped,
          rowsRestored: toRestore.length,
          rowsFailed: errors.length,
        },
        select: { id: true },
      });

      if (toInsert.length > 0) {
        await tx.transaction.createMany({
          data: toInsert.map(({ transaction, dedupKey }) =>
            toRow(transaction, account.id, batch.id, dedupKey),
          ),
        });
      }

      if (toRestore.length > 0) {
        // Restored, not re-inserted: the unique index covers soft-deleted rows, so an
        // insert would hit P2002. The original batch stays as the row's provenance.
        await tx.transaction.updateMany({
          where: { id: { in: toRestore.map(({ id }) => id) } },
          data: { deletedAt: null },
        });
        // A removed upload whose rows this file brings back stands again: it holds live rows,
        // so it must be removable again, and must not claim to be gone.
        await tx.importBatch.updateMany({
          where: {
            id: { in: [...new Set(toRestore.map(({ importBatchId }) => importBatchId))] },
            undoneAt: { not: null },
          },
          data: { undoneAt: null },
        });
      }

      if (pendingToStore.length > 0) {
        await tx.transaction.createMany({
          data: pendingToStore.map((transaction) => toRow(transaction, account.id, batch.id, null)),
        });
      }

      /*
       * Categorized here, in the same transaction, so an import is one step rather than
       * one step plus a button the user has to remember. Scoped to the rows this import
       * inserted or restored: rows already stored keep whatever they hold, which is what
       * stops an import from quietly undoing a hand-set category.
       *
       * createMany does not return ids, so the inserted rows are read back by the batch
       * that owns them — every row of this batch is a row this import just wrote.
       */
      const inserted = await tx.transaction.findMany({
        where: { importBatchId: batch.id },
        select: { id: true },
      });
      const touched = [...inserted.map((row) => row.id), ...toRestore.map(({ id }) => id)];

      return { batchId: batch.id, categorized: await this.rules.applyToRows(tx, touched) };
    });

    this.logger.log(
      `import ${batchId} imported=${String(toInsert.length)} skipped=${String(skipped)} ` +
        `restored=${String(toRestore.length)} pendingReplaced=${String(pendingToStore.length)} ` +
        `categorized=${String(categorized)}` +
        (stale ? ' (older export: pending left untouched)' : ''),
    );

    return {
      batchId,
      parsed: transactions.length,
      imported: toInsert.length,
      skipped,
      restored: toRestore.length,
      pendingReplaced: pendingToStore.length,
      categorized,
      failed: reported,
      failedCount: errors.length,
      encoding,
      dialect,
      ...(priorBatch === null ? {} : { duplicateOfBatchId: priorBatch.id }),
    };
  }

  /** File-level failures reject the request; row-level ones are reported and survived. */
  private parse(
    text: string,
    request: ImportRequest,
    encoding: 'utf-8' | 'windows-1252',
  ): {
    dialect: BankDialectId;
    transactions: readonly ParsedTransaction[];
    errors: readonly RowError[];
  } {
    try {
      // Detected from the header, never asked of the user: a wrong answer would parse a
      // real file into wrong numbers instead of failing.
      const detected = detectDialect(text);
      if (detected === undefined) {
        throw new CsvFileError('HEADER_NOT_FOUND');
      }
      const { dialect } = detected;
      return {
        dialect: dialect.id,
        ...parseBankCsv(text, dialect, {
          fileName: request.fileName,
          encoding,
          referenceYear: request.referenceYear ?? new Date().getUTCFullYear(),
        }),
      };
    } catch (error) {
      if (error instanceof CsvFileError) {
        throw new BadRequestException({ code: error.code, columns: error.columns });
      }
      const code = csvErrorCode(error);
      if (code !== undefined) {
        throw new BadRequestException({ code });
      }
      throw error;
    }
  }

  /**
   * Every row must belong to the account the user picked. The pending set and the
   * stale-export watermark are both per account, so a file from another account does not
   * just add foreign rows: it wipes this account's pending rows, and its dates decide
   * whether this account's next real export counts as older. Checked before anything is
   * written, so a refused file changes nothing.
   *
   * Per row, not once per file: Sparkasse repeats the owner IBAN on every row, and one
   * foreign row among many is still a foreign row. The file's IBANs go back masked, the
   * way the account list shows them, so the user can tell which account the file is for.
   */
  private requireOwnIban(accountIban: string, transactions: readonly ParsedTransaction[]): void {
    const foreign = new Set(
      transactions
        .map((transaction) => transaction.accountIban.toUpperCase())
        .filter((iban) => iban !== accountIban),
    );
    if (foreign.size > 0) {
      throw new BadRequestException({
        code: 'ACCOUNT_IBAN_MISMATCH',
        columns: [...foreign].map(maskIban),
      });
    }
  }

  /**
   * An export is a snapshot as of its newest *booked* date, and the pending set is only ever
   * replaced wholesale. That is right for the newest file and wrong for any older one:
   * re-importing last month's statement would otherwise delete pending rows it never saw,
   * and reinstate the ones it still shows as pending. Its booked rows still import — they
   * are a ledger, and dedup handles them.
   *
   * Booked rows on both sides of the comparison, deliberately. A pending row carries the
   * date the bank expects to book it, which for a standing order is in the future: counting
   * those would park the watermark ahead of every later export, and the pending set would
   * stay frozen — a cancelled standing order still on screen, still counted — until that
   * date passed.
   */
  private async isStaleExport(
    accountId: string,
    booked: readonly ParsedTransaction[],
  ): Promise<boolean> {
    const newestStored = await this.prisma.transaction.findFirst({
      where: { accountId, deletedAt: null, status: 'booked' },
      orderBy: { bookingDate: 'desc' },
      select: { bookingDate: true },
    });
    if (newestStored === null) {
      return false;
    }

    // 'YYYY-MM-DD' compares lexicographically. A file with no booked row at all has no
    // newest date, sorts below everything, and so is treated as stale rather than allowed
    // to empty the pending set.
    const newestBooked = booked.reduce(
      (latest, transaction) =>
        transaction.bookingDate > latest ? transaction.bookingDate : latest,
      '',
    );

    return newestBooked < newestStored.bookingDate;
  }

  private dedupKeysFor(
    booked: readonly ParsedTransaction[],
  ): { transaction: ParsedTransaction; dedupKey: string }[] {
    const fingerprints = booked.map(fingerprintInput);
    const occurrences = assignOccurrences(fingerprints);

    return booked.map((transaction, index) => ({
      transaction,
      dedupKey: dedupKeyHash(dedupKeyInput(fingerprints[index] ?? '', occurrences[index] ?? 0)),
    }));
  }

  /**
   * The three-way match. A key that is already stored and live is a duplicate and is
   * skipped; one whose row was soft-deleted is restored, because deletion is local and
   * the file is the source of truth; one that is absent is new.
   */
  private async classify(
    accountId: string,
    keyed: readonly { transaction: ParsedTransaction; dedupKey: string }[],
  ): Promise<{
    toInsert: { transaction: ParsedTransaction; dedupKey: string }[];
    toRestore: { id: string; importBatchId: string }[];
    skipped: number;
  }> {
    const stored = await this.prisma.transaction.findMany({
      where: { accountId, dedupKey: { in: keyed.map(({ dedupKey }) => dedupKey) } },
      select: { id: true, dedupKey: true, deletedAt: true, importBatchId: true },
    });
    const byKey = new Map(stored.map((row) => [row.dedupKey, row]));

    const toInsert: { transaction: ParsedTransaction; dedupKey: string }[] = [];
    const toRestore: { id: string; importBatchId: string }[] = [];
    let skipped = 0;

    for (const entry of keyed) {
      const row = byKey.get(entry.dedupKey);
      if (row === undefined) {
        toInsert.push(entry);
      } else if (row.deletedAt === null) {
        skipped += 1;
      } else {
        toRestore.push({ id: row.id, importBatchId: row.importBatchId });
      }
    }

    return { toInsert, toRestore, skipped };
  }

  /**
   * Logs the code, the column and the offending value only. Never the purpose or the
   * counterparty: that is the user's spending history, and this is an info-level log.
   */
  private logRowError(error: RowError): void {
    const field = error.field === undefined ? '' : ` field=${error.field}`;
    const value = error.value === undefined ? '' : ` value="${sanitizeForLog(error.value)}"`;
    this.logger.warn(`import row ${String(error.line)} ${error.code}${field}${value}`);
  }
}
