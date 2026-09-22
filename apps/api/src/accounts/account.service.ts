import { AccountPayload, BookingStatus, TransactionPayload } from '@household-budget/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

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
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

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

    return rows.map((row) => ({
      id: row.id,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate,
      amountCents: row.amountCents,
      currency: row.currency,
      status: row.status as BookingStatus,
      counterpartyName: row.counterpartyName,
      purpose: row.purpose,
      bookingText: row.bookingText,
      bankCategory: row.bankCategory,
    }));
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
