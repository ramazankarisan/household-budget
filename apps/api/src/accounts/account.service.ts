import { AccountPayload, BookingStatus, TransactionPayload } from '@household-budget/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from '../rules/category.service.js';

/** Prisma's code for a unique-constraint violation. `Account.iban` is the only one here. */
const UNIQUE_CONSTRAINT = 'P2002';

function normalizeIban(raw: string): string {
  return raw.replaceAll(' ', '').toUpperCase();
}

/**
 * Accounts, and the transactions that belong to them.
 *
 * Reading and deleting transactions lives here rather than in its own service because
 * a transaction is only ever reached through its account: imports are scoped to an
 * account the user picked before uploading, which is what keeps rows out of the wrong
 * one.
 */
/** Every row Prisma returns for a transaction; the payload is a projection of it. */
type TransactionRow = {
  id: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  status: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  purpose: string | null;
  bookingText: string | null;
  bankCategory: string | null;
  categoryId: string | null;
  categoryLockedAt: Date | null;
};

function toPayload(row: TransactionRow): TransactionPayload {
  return {
    id: row.id,
    bookingDate: row.bookingDate,
    valueDate: row.valueDate,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status as BookingStatus,
    counterpartyName: row.counterpartyName,
    counterpartyIban: row.counterpartyIban,
    purpose: row.purpose,
    bookingText: row.bookingText,
    bankCategory: row.bankCategory,
    categoryId: row.categoryId,
    // ISO, never a Date: the payload crosses JSON and core has no Date to parse it back.
    categoryLockedAt: row.categoryLockedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryService,
  ) {}

  async create(iban: string, name: string): Promise<AccountPayload> {
    const normalized = normalizeIban(iban.trim());
    const trimmedName = name.trim();

    if (normalized === '') {
      throw new BadRequestException('iban is required');
    }
    if (trimmedName === '') {
      throw new BadRequestException('name is required');
    }

    try {
      const account = await this.prisma.account.create({
        data: { iban: normalized, name: trimmedName },
      });
      return { id: account.id, iban: account.iban, name: account.name };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT) {
        throw new ConflictException(`An account for ${normalized} already exists`);
      }
      throw error;
    }
  }

  async list(): Promise<AccountPayload[]> {
    const accounts = await this.prisma.account.findMany({ orderBy: { name: 'asc' } });
    return accounts.map((account) => ({
      id: account.id,
      iban: account.iban,
      name: account.name,
    }));
  }

  /** Throws rather than returning null: every caller here needs the account to exist. */
  async requireAccount(accountId: string): Promise<{ id: string; iban: string }> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (account === null) {
      throw new NotFoundException(`No account ${accountId}`);
    }
    return { id: account.id, iban: account.iban };
  }

  /** Newest booking date first, soft-deleted rows excluded. */
  async listTransactions(accountId: string): Promise<TransactionPayload[]> {
    await this.requireAccount(accountId);

    const rows = await this.prisma.transaction.findMany({
      where: { accountId, deletedAt: null },
      orderBy: [{ bookingDate: 'desc' }, { lineNumber: 'asc' }],
    });

    return rows.map(toPayload);
  }

  /**
   * Sets or clears the category a human chose, and records that a human chose it.
   *
   * `categoryLockedAt` is what keeps the rules engine off the row afterwards — the
   * decision cannot be inferred from `categoryId != null`, because a rule sets that too.
   * Clearing unlocks as well, which makes the row eligible for the next apply.
   *
   * Refused on a pending row and on a soft-deleted one. Both would take a decision and
   * then lose it: the pending set is replaced wholesale by the next import, and those
   * rows carry no dedupKey to be matched back to, so the replacement cannot inherit
   * anything; a soft-deleted row is invisible everywhere in the UI, yet its category
   * would still count against deleting that category. A rule may still categorize
   * either — that assignment is re-derived on every apply rather than remembered.
   */
  async setTransactionCategory(
    transactionId: string,
    categoryId: string | null,
  ): Promise<TransactionPayload> {
    const existing = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (existing === null || existing.deletedAt !== null) {
      throw new NotFoundException(`No transaction ${transactionId}`);
    }
    if (existing.status === 'pending') {
      throw new ConflictException({ code: 'TRANSACTION_PENDING' });
    }
    if (categoryId !== null) {
      await this.categories.requireCategory(categoryId);
    }

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { categoryId, categoryLockedAt: categoryId === null ? null : new Date() },
    });

    return toPayload(updated);
  }

  /**
   * Soft delete, never a hard one. Deletion is local and the bank file is the source of
   * truth, so the next import of a file containing this row brings it back — which only
   * works if the row is still there to restore.
   */
  async softDeleteTransaction(transactionId: string): Promise<void> {
    const existing = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (existing === null) {
      throw new NotFoundException(`No transaction ${transactionId}`);
    }
    if (existing.deletedAt !== null) {
      return;
    }
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { deletedAt: new Date() },
    });
  }
}
