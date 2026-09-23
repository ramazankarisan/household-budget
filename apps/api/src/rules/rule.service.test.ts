import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AccountService } from '../accounts/account.service.js';
import { ImportService } from '../import/import.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from './category.service.js';
import { RuleService } from './rule.service.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');

/** Fixed, so the two-digit years in the fixtures resolve the same way on any day. */
const referenceYear = 2026;

let prisma: PrismaService;
let categories: CategoryService;
let rules: RuleService;
let accounts: AccountService;
let imports: ImportService;

beforeEach(async () => {
  if (prisma === undefined) {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, CategoryService, RuleService, AccountService, ImportService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryService);
    rules = moduleRef.get(RuleService);
    accounts = moduleRef.get(AccountService);
    imports = moduleRef.get(ImportService);
  }

  await prisma.transaction.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.account.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.category.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RuleService', () => {
  it('stores a valid rule', async () => {
    const wohnen = await categories.create('Wohnen');

    const created = await rules.create({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'Müller',
      priority: 10,
      categoryId: wohnen.id,
    });

    expect(created).toMatchObject({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'Müller',
      priority: 10,
      categoryId: wohnen.id,
      active: true,
    });
  });

  it('rejects an empty keyword with the code the form marks a field by', async () => {
    const wohnen = await categories.create('Wohnen');

    const failure = await rules
      .create({ field: 'purpose', operator: 'contains', value: '', categoryId: wohnen.id })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure).toMatchObject({
      response: { code: 'RULE_INVALID', errors: [{ code: 'VALUE_EMPTY', field: 'value' }] },
    });
    expect(await rules.list()).toEqual([]);
  });

  it('404s on a category that does not exist', async () => {
    await expect(
      rules.create({
        field: 'purpose',
        operator: 'contains',
        value: 'Miete',
        categoryId: 'cat-nope',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on a rule that does not exist', async () => {
    await expect(rules.requireRule('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(rules.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists rules in the order they will be applied, ties included', async () => {
    // Inserted out of order and with a priority tie, because arrival order is exactly
    // what the ordering must not depend on.
    const wohnen = await categories.create('Wohnen');
    const rule = (value: string, priority: number) =>
      rules.create({
        field: 'purpose',
        operator: 'contains',
        value,
        priority,
        categoryId: wohnen.id,
      });

    const third = await rule('c', 30);
    const firstTie = await rule('a', 10);
    const secondTie = await rule('b', 10);

    expect((await rules.list()).map((entry) => entry.id)).toEqual([
      firstTie.id,
      secondTie.id,
      third.id,
    ]);
  });

  it('keeps a switched-off rule on the list', async () => {
    // It has to be visible to be switched back on; only the engine filters it out.
    const wohnen = await categories.create('Wohnen');
    const created = await rules.create({
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      categoryId: wohnen.id,
      active: false,
    });

    expect(await rules.list()).toEqual([{ ...created, active: false }]);
  });

  it('updates a rule wholesale', async () => {
    const wohnen = await categories.create('Wohnen');
    const lebensmittel = await categories.create('Lebensmittel');
    const created = await rules.create({
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      categoryId: wohnen.id,
    });

    const updated = await rules.update(created.id, {
      field: 'counterpartyName',
      operator: 'startsWith',
      value: 'REWE',
      priority: 5,
      categoryId: lebensmittel.id,
      active: false,
    });

    expect(updated).toEqual({
      id: created.id,
      field: 'counterpartyName',
      operator: 'startsWith',
      value: 'REWE',
      priority: 5,
      categoryId: lebensmittel.id,
      active: false,
    });
  });

  it('strips an IBAN of its grouping spaces before storing it', async () => {
    const gesundheit = await categories.create('Gesundheit');

    const created = await rules.create({
      field: 'counterpartyIban',
      operator: 'equals',
      value: 'DE89 3704 0044 0532 0130 00',
      categoryId: gesundheit.id,
    });

    expect(created.value).toBe('de89370400440532013000');
  });

  it('deletes a rule', async () => {
    const wohnen = await categories.create('Wohnen');
    const created = await rules.create({
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      categoryId: wohnen.id,
    });

    await rules.remove(created.id);

    expect(await rules.list()).toEqual([]);
  });
});

/**
 * The applying half. These run against the real fixture rather than hand-made rows: the
 * `Müller GmbH` payee, the absent one on the rent row and the CRLF purpose are the cases
 * the engine exists for, and inventing them here would be inventing a friendlier file.
 */
describe('RuleService.applyAll', () => {
  async function imported(): Promise<string> {
    const account = await accounts.create('DE89370400440532013000', 'Giro');
    await imports.importCsv({
      accountId: account.id,
      fileName: 'sparkasse-camt-18.csv',
      bytes: new Uint8Array(readFileSync(resolve(fixtures, 'sparkasse-camt-18.csv'))),
      referenceYear,
    });
    return account.id;
  }

  const muellerRow = (accountId: string) =>
    prisma.transaction.findFirstOrThrow({
      where: { accountId, counterpartyName: 'Müller GmbH' },
    });

  async function wohnenRule(value = 'müller'): Promise<{ ruleId: string; categoryId: string }> {
    const wohnen = await categories.create('Wohnen');
    const rule = await rules.create({
      field: 'counterpartyName',
      operator: 'contains',
      value,
      priority: 10,
      categoryId: wohnen.id,
    });
    return { ruleId: rule.id, categoryId: wohnen.id };
  }

  it('categorizes a payee SQL could not have matched', async () => {
    // `LIKE '%müller%'` does not match `Müller GmbH` on this SQLite build. This is the
    // assertion the whole in-JavaScript design exists for.
    const accountId = await imported();
    const { categoryId } = await wohnenRule();

    const summary = await rules.applyAll();

    expect((await muellerRow(accountId)).categoryId).toBe(categoryId);
    expect(summary.assigned).toBeGreaterThan(0);
  });

  it('writes nothing the second time', async () => {
    const accountId = await imported();
    await wohnenRule();

    const first = await rules.applyAll();
    const second = await rules.applyAll();

    expect(first.assigned).toBeGreaterThan(0);
    expect(second).toEqual({
      evaluated: first.evaluated,
      assigned: 0,
      cleared: 0,
      locked: 0,
    });
    expect((await muellerRow(accountId)).categoryId).not.toBeNull();
  });

  it('leaves a category the user set by hand exactly where it is', async () => {
    // The single line most likely to be forgotten and least likely to be noticed.
    const accountId = await imported();
    const { categoryId: wohnenId } = await wohnenRule();
    const lebensmittel = await categories.create('Lebensmittel');
    const row = await muellerRow(accountId);

    await accounts.setTransactionCategory(row.id, lebensmittel.id);
    const summary = await rules.applyAll();

    const after = await muellerRow(accountId);
    expect(after.categoryId).toBe(lebensmittel.id);
    expect(after.categoryId).not.toBe(wohnenId);
    expect(after.categoryLockedAt).not.toBeNull();
    expect(summary.locked).toBe(1);
  });

  it('makes a row eligible again once the user clears it', async () => {
    const accountId = await imported();
    const { categoryId } = await wohnenRule();
    const row = await muellerRow(accountId);
    await accounts.setTransactionCategory(row.id, categoryId);

    await accounts.setTransactionCategory(row.id, null);
    const cleared = await muellerRow(accountId);
    expect(cleared.categoryId).toBeNull();
    expect(cleared.categoryLockedAt).toBeNull();

    await rules.applyAll();

    expect((await muellerRow(accountId)).categoryId).toBe(categoryId);
  });

  it('clears the category a deleted rule had assigned', async () => {
    // Otherwise the category outlives the reason it was there, and nothing on screen
    // says why the row is in it.
    const accountId = await imported();
    const { ruleId } = await wohnenRule();
    await rules.applyAll();

    await rules.remove(ruleId);
    const summary = await rules.applyAll();

    expect((await muellerRow(accountId)).categoryId).toBeNull();
    expect(summary.cleared).toBe(1);
  });

  it('clears a rule-assigned category once the last rule is gone, but not a hand-set one', async () => {
    // An unlocked category is there because a rule put it there, so with no rules left
    // the honest answer is "uncategorized". A hand-set row is locked and is never loaded.
    const accountId = await imported();
    const { ruleId, categoryId } = await wohnenRule();
    await rules.applyAll();
    const byRule = await muellerRow(accountId);
    // A booked row: the fixture's Ärzte GmbH is pending, and a pending row cannot be
    // pinned by hand at all.
    const byHand = await prisma.transaction.findFirstOrThrow({
      where: { accountId, counterpartyName: 'Sparkasse Musterstadt' },
    });
    await accounts.setTransactionCategory(byHand.id, categoryId);

    await rules.remove(ruleId);
    await rules.applyAll();

    expect(
      (await prisma.transaction.findFirstOrThrow({ where: { id: byRule.id } })).categoryId,
    ).toBeNull();
    expect(
      (await prisma.transaction.findFirstOrThrow({ where: { id: byHand.id } })).categoryId,
    ).toBe(categoryId);
  });

  it('ignores a rule the user switched off', async () => {
    const accountId = await imported();
    const { ruleId, categoryId } = await wohnenRule();
    await rules.applyAll();

    await rules.update(ruleId, {
      field: 'counterpartyName',
      operator: 'contains',
      value: 'müller',
      priority: 10,
      categoryId,
      active: false,
    });
    await rules.applyAll();

    expect((await muellerRow(accountId)).categoryId).toBeNull();
  });

  it('lets the lower priority win when two rules claim the same row', async () => {
    const accountId = await imported();
    const { categoryId: wohnenId } = await wohnenRule();
    const sonstiges = await categories.create('Sonstiges');
    await rules.create({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'gmbh',
      priority: 5,
      categoryId: sonstiges.id,
    });

    await rules.applyAll();

    expect((await muellerRow(accountId)).categoryId).toBe(sonstiges.id);
    expect(wohnenId).not.toBe(sonstiges.id);
  });

  it('covers soft-deleted rows, so a restored one comes back categorized', async () => {
    const accountId = await imported();
    const { categoryId } = await wohnenRule();
    const row = await muellerRow(accountId);
    await accounts.softDeleteTransaction(row.id);

    await rules.applyAll();

    const hidden = await prisma.transaction.findFirstOrThrow({ where: { id: row.id } });
    expect(hidden.deletedAt).not.toBeNull();
    expect(hidden.categoryId).toBe(categoryId);
  });
});

/**
 * The cases a review found: each one loses or invents a category behind the user's back,
 * and none of them is visible from the happy path above.
 */
describe('RuleService, decisions that must not be undone', () => {
  async function imported(): Promise<string> {
    const account = await accounts.create('DE89370400440532013000', 'Giro');
    await imports.importCsv({
      accountId: account.id,
      fileName: 'sparkasse-camt-18.csv',
      bytes: new Uint8Array(readFileSync(resolve(fixtures, 'sparkasse-camt-18.csv'))),
      referenceYear,
    });
    return account.id;
  }

  it('does not switch a disabled rule back on when the body omits `active`', async () => {
    // parseRuleInput reads an absent `active` as "on", which is right for a create and
    // would silently re-categorize rows here.
    const wohnen = await categories.create('Wohnen');
    const created = await rules.create({
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      categoryId: wohnen.id,
      active: false,
    });

    const updated = await rules.update(created.id, {
      field: 'purpose',
      operator: 'contains',
      value: 'Mietzahlung',
      categoryId: wohnen.id,
    });

    expect(updated.active).toBe(false);
  });

  it('still switches a rule on when the body says so', async () => {
    const wohnen = await categories.create('Wohnen');
    const created = await rules.create({
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      categoryId: wohnen.id,
      active: false,
    });

    const updated = await rules.update(created.id, {
      field: 'purpose',
      operator: 'contains',
      value: 'Miete',
      categoryId: wohnen.id,
      active: true,
    });

    expect(updated.active).toBe(true);
  });

  it('refuses to pin a category to a pending row', async () => {
    // The next import replaces the pending set wholesale, and those rows carry no
    // dedupKey for the replacement to inherit from, so the decision could not survive.
    const accountId = await imported();
    const wohnen = await categories.create('Wohnen');
    const pending = await prisma.transaction.findFirstOrThrow({
      where: { accountId, status: 'pending' },
    });

    await expect(accounts.setTransactionCategory(pending.id, wohnen.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to categorize a row the user deleted', async () => {
    // It is invisible everywhere in the UI, but its category would still count against
    // deleting that category.
    const accountId = await imported();
    const wohnen = await categories.create('Wohnen');
    const row = await prisma.transaction.findFirstOrThrow({
      where: { accountId, counterpartyName: 'Müller GmbH' },
    });
    await accounts.softDeleteTransaction(row.id);

    await expect(accounts.setTransactionCategory(row.id, wohnen.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
