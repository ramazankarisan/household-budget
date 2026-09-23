import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from './category.service.js';
import { RuleService } from './rule.service.js';

let prisma: PrismaService;
let categories: CategoryService;
let rules: RuleService;

beforeEach(async () => {
  if (prisma === undefined) {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, CategoryService, RuleService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryService);
    rules = moduleRef.get(RuleService);
  }

  // Order matters: Transaction, Rule and Budget all hold a foreign key into Category.
  await prisma.budget.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.account.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.category.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A transaction needs an account and a batch; neither is what these tests are about. */
async function transactionIn(categoryId: string, deletedAt: Date | null = null): Promise<void> {
  const account = await prisma.account.create({
    data: { iban: `DE${String(Date.now())}${String(Math.random()).slice(2, 8)}`, name: 'Giro' },
  });
  const batch = await prisma.importBatch.create({
    data: {
      accountId: account.id,
      fileName: 'f.csv',
      fileHash: 'h',
      encoding: 'utf-8',
      rowsParsed: 1,
      rowsImported: 1,
      rowsSkipped: 0,
      rowsRestored: 0,
      rowsFailed: 0,
    },
  });
  await prisma.transaction.create({
    data: {
      accountId: account.id,
      importBatchId: batch.id,
      dedupKey: `k${String(Math.random())}`,
      accountIban: account.iban,
      bookingDate: '2025-09-22',
      amountCents: -1000,
      currency: 'EUR',
      status: 'booked',
      lineNumber: 2,
      raw: '{}',
      categoryId,
      deletedAt,
    },
  });
}

describe('CategoryService', () => {
  it('creates a category and trims its name', async () => {
    const created = await categories.create('  Wohnen  ');

    expect(created.name).toBe('Wohnen');
    expect(await categories.list()).toEqual([created]);
  });

  it('refuses a second category with the same name', async () => {
    await categories.create('Wohnen');

    await expect(categories.create('Wohnen')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a category nothing points at', async () => {
    const created = await categories.create('Unbenutzt');

    await categories.remove(created.id);

    expect(await categories.list()).toEqual([]);
  });

  it('refuses to delete a category in use, and names how many use it', async () => {
    // The counts are the whole point: "in use" without them is a dead end.
    const wohnen = await categories.create('Wohnen');
    await rules.create({
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      priority: 10,
      categoryId: wohnen.id,
    });
    await transactionIn(wohnen.id);
    await transactionIn(wohnen.id);

    await expect(categories.remove(wohnen.id)).rejects.toMatchObject({
      response: { code: 'CATEGORY_IN_USE', rules: 1, transactions: 2 },
    });
    expect(await categories.list()).toHaveLength(1);
  });

  it('does not count a deleted row against the deletion, and lets the delete clear it', async () => {
    // A soft-deleted row is invisible everywhere in the UI, so counting it refuses with a
    // number the user has nothing on screen to act on.
    const wohnen = await categories.create('Wohnen');
    await transactionIn(wohnen.id, new Date());

    await categories.remove(wohnen.id);

    expect(await categories.list()).toEqual([]);
    const hidden = await prisma.transaction.findFirstOrThrow({
      where: { deletedAt: { not: null } },
    });
    expect(hidden.categoryId).toBeNull();
  });

  it('still counts a live row, deleted rows in the same category or not', async () => {
    const wohnen = await categories.create('Wohnen');
    await transactionIn(wohnen.id);
    await transactionIn(wohnen.id, new Date());

    await expect(categories.remove(wohnen.id)).rejects.toMatchObject({
      response: { code: 'CATEGORY_IN_USE', rules: 0, transactions: 1 },
    });
  });

  it('refuses to delete a category that only has a budget, and says so', async () => {
    // A limit is a decision the user made about this category in a month they typed it
    // into, and the count is what turns "in use" into something they can act on.
    const wohnen = await categories.create('Wohnen');
    await prisma.budget.create({
      data: { categoryId: wohnen.id, month: '2025-09', amountCents: 70000 },
    });

    await expect(categories.remove(wohnen.id)).rejects.toMatchObject({
      response: { code: 'CATEGORY_IN_USE', rules: 0, transactions: 0, budgets: 1 },
    });
    expect(await categories.list()).toHaveLength(1);
  });

  it('renames a category', async () => {
    const created = await categories.create('Wohnnen');

    const renamed = await categories.rename(created.id, 'Wohnen');

    expect(renamed).toEqual({ id: created.id, name: 'Wohnen' });
  });

  it('404s on an unknown category', async () => {
    await expect(categories.requireCategory('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(categories.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
