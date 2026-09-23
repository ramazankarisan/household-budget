import { MAX_BUDGET_CENTS } from '@household-budget/core';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from '../rules/category.service.js';
import { BudgetService } from './budget.service.js';

let prisma: PrismaService;
let budgets: BudgetService;
let categories: CategoryService;

beforeEach(async () => {
  if (prisma === undefined) {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, CategoryService, BudgetService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    budgets = moduleRef.get(BudgetService);
    categories = moduleRef.get(CategoryService);
  }

  // Order matters: Budget holds a foreign key into Category, as Rule and Transaction do.
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

/** The codes a refusal carries, in the `BUDGET_INVALID` shape `RULE_INVALID` established. */
async function codesOf(call: Promise<unknown>): Promise<string[]> {
  try {
    await call;
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as {
        code: string;
        errors: readonly { code: string }[];
      };
      expect(response.code).toBe('BUDGET_INVALID');
      return response.errors.map((entry) => entry.code);
    }
    throw error;
  }
  throw new Error('expected a BadRequestException');
}

describe('BudgetService', () => {
  it('reports no limits for a month nobody has budgeted', async () => {
    expect(await budgets.list('2025-09')).toEqual([]);
  });

  it('sets a limit and reads it back', async () => {
    const wohnen = await categories.create('Wohnen');

    const saved = await budgets.set('2025-09', wohnen.id, { amountCents: 70000 });

    expect(saved).toEqual({ categoryId: wohnen.id, month: '2025-09', amountCents: 70000 });
    expect(await budgets.list('2025-09')).toEqual([saved]);
  });

  it('updates the same cell rather than adding a second row', async () => {
    // One row per category per month is what the unique index is for; this is the PUT
    // that would otherwise have to be a POST or a PATCH depending on what is stored.
    const wohnen = await categories.create('Wohnen');
    await budgets.set('2025-09', wohnen.id, { amountCents: 70000 });

    await budgets.set('2025-09', wohnen.id, { amountCents: 80000 });

    expect(await budgets.list('2025-09')).toEqual([
      { categoryId: wohnen.id, month: '2025-09', amountCents: 80000 },
    ]);
    expect(await prisma.budget.count()).toBe(1);
  });

  it('keeps two months of the same category apart', async () => {
    const wohnen = await categories.create('Wohnen');

    await budgets.set('2025-09', wohnen.id, { amountCents: 70000 });
    await budgets.set('2025-10', wohnen.id, { amountCents: 75000 });

    expect(await budgets.list('2025-09')).toEqual([
      { categoryId: wohnen.id, month: '2025-09', amountCents: 70000 },
    ]);
    expect(await budgets.list('2025-10')).toEqual([
      { categoryId: wohnen.id, month: '2025-10', amountCents: 75000 },
    ]);
  });

  it('clears one limit and leaves the month its others', async () => {
    const wohnen = await categories.create('Wohnen');
    const essen = await categories.create('Lebensmittel');
    await budgets.set('2025-09', wohnen.id, { amountCents: 70000 });
    await budgets.set('2025-09', essen.id, { amountCents: 40000 });

    await budgets.remove('2025-09', wohnen.id);

    expect(await budgets.list('2025-09')).toEqual([
      { categoryId: essen.id, month: '2025-09', amountCents: 40000 },
    ]);
  });

  it('clears a cell that was never set without complaining', async () => {
    // The caller asked for a state, and the state holds — the posture
    // `softDeleteTransaction` takes for a row already deleted.
    const wohnen = await categories.create('Wohnen');

    await expect(budgets.remove('2025-09', wohnen.id)).resolves.toBeUndefined();
  });

  it('accepts zero, which means nothing may be spent here', async () => {
    const wohnen = await categories.create('Wohnen');

    const saved = await budgets.set('2025-09', wohnen.id, { amountCents: 0 });

    expect(saved.amountCents).toBe(0);
  });

  it('refuses a month that is not one, on every route that takes one', async () => {
    const wohnen = await categories.create('Wohnen');

    expect(await codesOf(budgets.list('2025-13'))).toEqual(['MONTH_INVALID']);
    expect(await codesOf(budgets.list('2025-9'))).toEqual(['MONTH_INVALID']);
    expect(await codesOf(budgets.list('2025-'))).toEqual(['MONTH_INVALID']);
    expect(await codesOf(budgets.set('2025-13', wohnen.id, { amountCents: 1 }))).toEqual([
      'MONTH_INVALID',
    ]);
    expect(await codesOf(budgets.remove('x-y', wohnen.id))).toEqual(['MONTH_INVALID']);
  });

  it('refuses an amount that is negative, fractional, or past the cap', async () => {
    const wohnen = await categories.create('Wohnen');

    expect(await codesOf(budgets.set('2025-09', wohnen.id, { amountCents: -1 }))).toEqual([
      'AMOUNT_NEGATIVE',
    ]);
    expect(await codesOf(budgets.set('2025-09', wohnen.id, { amountCents: 1.5 }))).toEqual([
      'AMOUNT_NOT_AN_INTEGER',
    ]);
    expect(
      await codesOf(budgets.set('2025-09', wohnen.id, { amountCents: MAX_BUDGET_CENTS + 1 })),
    ).toEqual(['AMOUNT_TOO_LARGE']);
    expect(await codesOf(budgets.set('2025-09', wohnen.id, 'seventy'))).toEqual([
      'AMOUNT_NOT_AN_INTEGER',
    ]);
    expect(await prisma.budget.count()).toBe(0);
  });

  it('404s a limit for a category that does not exist', async () => {
    await expect(budgets.set('2025-09', 'nope', { amountCents: 70000 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
