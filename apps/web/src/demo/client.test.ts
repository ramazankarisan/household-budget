import { beforeEach, describe, expect, it } from 'vitest';

import type * as real from '../api/client';
import { type ApiError } from '../api/error';
import * as demo from './client';
import { bookings, DEMO_SETUP, shiftMonth } from './household';

// The demo build swaps one module for the other, so it must export everything the real
// client does, with the same types. This line is the check: typecheck fails otherwise.
const sameShape: typeof real = demo;

const END = { year: 2026, month: 10, day: 20 };

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected a rejection');
}

async function firstAccountRows() {
  const [account] = await demo.listAccounts();
  return demo.listTransactions(account?.id ?? '');
}

beforeEach(() => {
  demo.resetDemo(END);
});

it('exports what the real client does', () => {
  expect(Object.keys(sameShape).length).toBeGreaterThan(0);
});

describe('household', () => {
  it('spans six months up to the export day, newest first', () => {
    const rows = bookings(END);
    expect(rows[0]?.date).toBe('2026-10-20');
    expect(rows.at(-1)?.date.slice(0, 7)).toBe('2026-05');
    expect(rows.every((row) => row.date <= '2026-10-20')).toBe(true);
  });

  it('crosses a year boundary', () => {
    expect(shiftMonth(2027, 1, -1)).toBe('2026-12');
    expect(bookings({ year: 2027, month: 2, day: 28 }).at(-1)?.date.slice(0, 7)).toBe('2026-09');
  });
});

describe('the seed', () => {
  it('is one imported account with its categories, rules and limits', async () => {
    const [accounts, categories, rules, budgets, imports] = await Promise.all([
      demo.listAccounts(),
      demo.listCategories(),
      demo.listRules(),
      demo.listBudgets('2026-10'),
      demo.listImports(),
    ]);
    expect(accounts).toHaveLength(1);
    expect(categories).toHaveLength(DEMO_SETUP.length);
    expect(rules.map((rule) => rule.priority)).toEqual(
      rules.map((_rule, index) => 100 + index * 10),
    );
    expect(budgets).toHaveLength(DEMO_SETUP.filter(([, , limit]) => limit > 0).length);
    expect(await demo.listBudgets('2026-07')).toEqual([]);
    expect(imports[0]?.rowsImported).toBe(bookings(END).length);
  });

  it('has the rules applied: only the salary is left uncategorized', async () => {
    const rows = await firstAccountRows();
    const open = rows.filter((row) => row.categoryId === null);
    expect(new Set(open.map((row) => row.counterpartyName))).toEqual(new Set(['Beispiel AG']));
    // `Bäckerei` finds `BAECKEREI SCHMIDT`, as in the real app.
    expect(rows.find((row) => row.counterpartyName === 'BAECKEREI SCHMIDT')?.categoryId).not.toBe(
      null,
    );
  });
});

describe('rules', () => {
  it('apply clears what a deleted rule assigned and spares a hand-set row', async () => {
    const rows = await firstAccountRows();
    const rewe = rows.filter((row) => row.counterpartyName === 'REWE SAGT DANKE');
    const [pinned] = rewe;
    const freizeit = (await demo.listCategories()).find((category) => category.name === 'Freizeit');
    await demo.setTransactionCategory(pinned?.id ?? '', freizeit?.id ?? '');

    const rule = (await demo.listRules()).find((candidate) => candidate.value === 'REWE');
    await demo.deleteRule(rule?.id ?? '');
    const summary = await demo.applyRules();

    expect(summary.cleared).toBe(rewe.length - 1);
    expect(summary.locked).toBe(1);
    const after = await firstAccountRows();
    expect(after.find((row) => row.id === pinned?.id)?.categoryId).toBe(freizeit?.id);
  });

  it('appends a rule without a priority and restores a deleted one in place', async () => {
    const [category] = await demo.listCategories();
    const created = await demo.createRule({
      field: 'purpose',
      operator: 'contains',
      value: 'Gehalt',
      categoryId: category?.id ?? '',
      active: true,
    });
    const rules = await demo.listRules();
    expect(rules.at(-1)).toEqual(created);

    const deleted = await demo.deleteRule(rules[0]?.id ?? '');
    await demo.restoreRule(deleted);
    expect(await demo.listRules()).toEqual(rules);
    expect((await rejection(demo.restoreRule(deleted))).code).toBe('RULE_EXISTS');
  });

  it('refuses an invalid rule with the field errors', async () => {
    const error = await rejection(
      demo.createRule({
        field: 'purpose',
        operator: 'contains',
        value: '',
        categoryId: 'x',
        active: true,
      }),
    );
    expect(error.code).toBe('RULE_INVALID');
    expect(error.details['errors']).toBeInstanceOf(Array);
  });

  it('reorders, and refuses a stale order', async () => {
    const ids = (await demo.listRules()).map((rule) => rule.id).reverse();
    const reordered = await demo.reorderRules(ids);
    expect(reordered.map((rule) => rule.id)).toEqual(ids);
    expect((await rejection(demo.reorderRules(ids.slice(1)))).code).toBe('RULE_ORDER_STALE');
    expect((await rejection(demo.reorderRules([...ids, ids[0] ?? '']))).code).toBe(
      'RULE_ORDER_INVALID',
    );
  });

  it('updates a rule, keeping what the body leaves out', async () => {
    const [first] = await demo.listRules();
    if (first === undefined) {
      throw new Error('the seed has rules');
    }
    const { id, ...input } = first;
    const updated = await demo.updateRule(id, { ...input, active: false });
    expect(updated).toEqual({ ...first, active: false });
  });
});

describe('categories', () => {
  it('refuses to delete one in use, with the counts', async () => {
    const category = (await demo.listCategories()).find(({ name }) => name === 'Wohnen');
    const error = await rejection(demo.deleteCategory(category?.id ?? ''));
    expect(error.code).toBe('CATEGORY_IN_USE');
    expect(error.details).toMatchObject({ budgets: 3 });
  });

  it('creates, renames, recolours and deletes an unused one; names fold case', async () => {
    const created = await demo.createCategory(' Urlaub ');
    expect(created.name).toBe('Urlaub');
    await expect(demo.createCategory('urlaub')).rejects.toThrow(/already exists/u);
    const renamed = await demo.updateCategory(created.id, { name: 'Reisen', colorIndex: 7 });
    expect(renamed).toMatchObject({ name: 'Reisen', colorIndex: 7 });
    expect((await rejection(demo.updateCategory(created.id, { colorIndex: 8 }))).code).toBe(
      'CATEGORY_COLOR_INVALID',
    );
    await demo.deleteCategory(created.id);
    expect((await demo.listCategories()).some((category) => category.id === created.id)).toBe(
      false,
    );
  });
});

describe('budgets', () => {
  it('sets, replaces and clears a cell', async () => {
    const [category] = await demo.listCategories();
    const id = category?.id ?? '';
    await demo.setBudget('2026-11', id, 1_000);
    await demo.setBudget('2026-11', id, 2_000);
    expect(await demo.listBudgets('2026-11')).toEqual([
      { categoryId: id, month: '2026-11', amountCents: 2_000 },
    ]);
    await demo.clearBudget('2026-11', id);
    expect(await demo.listBudgets('2026-11')).toEqual([]);
    expect((await rejection(demo.listBudgets('2026-1'))).code).toBe('BUDGET_INVALID');
    expect((await rejection(demo.setBudget('2026-11', id, -1))).code).toBe('BUDGET_INVALID');
  });
});

describe('imports and accounts', () => {
  it('reads no file', async () => {
    const [account] = await demo.listAccounts();
    const file = new File(['x'], 'x.csv');
    expect((await rejection(demo.uploadImport(account?.id ?? '', file))).code).toBe(
      'DEMO_READ_ONLY',
    );
  });

  it('removes the upload with its rows, and brings them back', async () => {
    const [batch] = await demo.listImports();
    const removed = await demo.undoImport(batch?.id ?? '');
    expect(removed.undoneAt).not.toBe(null);
    expect(await firstAccountRows()).toEqual([]);
    await demo.restoreImport(batch?.id ?? '');
    expect(await firstAccountRows()).toHaveLength(bookings(END).length);
  });

  it('adds an account with a valid IBAN only', async () => {
    expect((await rejection(demo.createAccount('DE00 1234', 'Spar'))).code).toBe('IBAN_INVALID');
    const account = await demo.createAccount('de44 5001 0517 5407 3249 31', 'Spar');
    expect(account.iban).toBe('DE44500105175407324931');
    expect(await demo.listTransactions(account.id)).toEqual([]);
  });

  it('hands out copies, never the stored rows', async () => {
    const rows = await firstAccountRows();
    (rows[0] as { categoryId: string | null }).categoryId = 'changed';
    expect((await firstAccountRows())[0]?.categoryId).not.toBe('changed');
  });
});
