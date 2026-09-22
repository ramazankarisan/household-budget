import {
  assignOccurrences,
  CsvFileError,
  dedupKeyInput,
  fingerprintInput,
  ImportSummary,
  RowError,
  Transaction as ParsedTransaction,
} from '@household-budget/core';
import { parseSparkasseCsv } from '@household-budget/core/csv';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AccountService } from '../accounts/account.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeBankCsv } from './decode.js';
import { dedupKeyHash, sha256Hex } from './hash.js';

export interface ImportRequest {
  readonly accountId: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /** Resolves two-digit years. Defaults to now; injected so tests are not time-dependent. */
  readonly referenceYear?: number;
}

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
  ) {}

  async importCsv(request: ImportRequest): Promise<ImportSummary> {
    const account = await this.accounts.requireAccount(request.accountId);
    const fileHash = sha256Hex(request.bytes);

    const priorBatch = await this.prisma.importBatch.findFirst({
      where: { accountId: account.id, fileHash },
      orderBy: { importedAt: 'asc' },
      select: { id: true },
    });

    const { text, encoding } = decodeBankCsv(request.bytes);
    this.logger.log(
      `import account=${maskIban(account.iban)} file="${request.fileName}" encoding=${encoding}`,
    );

    const { transactions, errors } = this.parse(text, request, encoding);

    const booked = transactions.filter((transaction) => transaction.status === 'booked');
    const pending = transactions.filter((transaction) => transaction.status === 'pending');
    this.logger.log(
      `import parsed=${String(transactions.length)} booked=${String(booked.length)} ` +
        `pending=${String(pending.length)} errors=${String(errors.length)}`,
    );
    for (const error of errors) {
      this.logRowError(error);
    }

    const dedupKeys = this.dedupKeysFor(booked);
    const { toInsert, toRestore, skipped } = await this.classify(account.id, dedupKeys);
    const stale = await this.isStaleExport(account.id, booked);
    const pendingToStore = stale ? [] : pending;

    const batchId = await this.prisma.$transaction(async (tx) => {
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
          where: { id: { in: toRestore } },
          data: { deletedAt: null },
        });
      }

      if (pendingToStore.length > 0) {
        await tx.transaction.createMany({
          data: pendingToStore.map((transaction) => toRow(transaction, account.id, batch.id, null)),
        });
      }

      return batch.id;
    });

    this.logger.log(
      `import ${batchId} imported=${String(toInsert.length)} skipped=${String(skipped)} ` +
        `restored=${String(toRestore.length)} pendingReplaced=${String(pendingToStore.length)}` +
        (stale ? ' (older export: pending left untouched)' : ''),
    );

    return {
      batchId,
      parsed: transactions.length,
      imported: toInsert.length,
      skipped,
      restored: toRestore.length,
      pendingReplaced: pendingToStore.length,
      failed: errors,
      encoding,
      ...(priorBatch === null ? {} : { duplicateOfBatchId: priorBatch.id }),
    };
  }

  /** File-level failures reject the request; row-level ones are reported and survived. */
  private parse(
    text: string,
    request: ImportRequest,
    encoding: 'utf-8' | 'windows-1252',
  ): { transactions: readonly ParsedTransaction[]; errors: readonly RowError[] } {
    try {
      return parseSparkasseCsv(text, {
        fileName: request.fileName,
        encoding,
        referenceYear: request.referenceYear ?? new Date().getUTCFullYear(),
      });
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
    toRestore: string[];
    skipped: number;
  }> {
    const stored = await this.prisma.transaction.findMany({
      where: { accountId, dedupKey: { in: keyed.map(({ dedupKey }) => dedupKey) } },
      select: { id: true, dedupKey: true, deletedAt: true },
    });
    const byKey = new Map(stored.map((row) => [row.dedupKey, row]));

    const toInsert: { transaction: ParsedTransaction; dedupKey: string }[] = [];
    const toRestore: string[] = [];
    let skipped = 0;

    for (const entry of keyed) {
      const row = byKey.get(entry.dedupKey);
      if (row === undefined) {
        toInsert.push(entry);
      } else if (row.deletedAt === null) {
        skipped += 1;
      } else {
        toRestore.push(row.id);
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
    const value = error.value === undefined ? '' : ` value="${error.value}"`;
    this.logger.warn(`import row ${String(error.line)} ${error.code}${field}${value}`);
  }
}
