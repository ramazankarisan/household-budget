import {
  type AccountPayload,
  type ApplySummary,
  type BudgetPayload,
  CATEGORY_COLOR_COUNT,
  type CategoryPayload,
  compareRules,
  DEFAULT_RULE_PRIORITY,
  type DeletedRulePayload,
  type ImportBatchPayload,
  type ImportSummary,
  isMonthKey,
  isValidIban,
  matchingRule,
  normalize,
  orderRules,
  parseBudgetInput,
  parseRuleInput,
  type Rule,
  type RuleInput,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';

import { ApiError } from '../api/error';
import {
  bookings,
  budgetMonths,
  DEMO_ACCOUNT_NAME,
  DEMO_FILE_NAME,
  DEMO_IBAN,
  DEMO_SETUP,
  type ExportDay,
} from './household';

/*
 * The hosted demo's stand-in for `src/api/client.ts` (plan 12). `vite build --mode demo`
 * resolves every import of that module to this one; no other build can reach it.
 *
 * Same functions, same payloads, same refusals — but over an in-memory household seeded
 * from the synthetic data in `household.ts`, so the page needs no server and the API stays
 * on loopback. It mirrors the API's services in miniature and validates with the same core
 * functions they do; where the API words a refusal with a code, this throws that code.
 * A reload starts over.
 */

export { ApiError };

interface StoredTransaction extends TransactionPayload {
  readonly accountId: string;
  readonly batchId: string;
  /** Set while the upload holding the row is removed on /imports. */
  readonly deletedAt: string | null;
}

interface StoredCategory extends CategoryPayload {
  readonly createdAt: string;
}

interface State {
  accounts: AccountPayload[];
  transactions: StoredTransaction[];
  batches: ImportBatchPayload[];
  categories: StoredCategory[];
  rules: Rule[];
  budgets: BudgetPayload[];
  /** Ids and timestamps are counted, so two made in the same millisecond still sort. */
  sequence: number;
}

const PRIORITY_STEP = 10;

function emptyState(): State {
  return {
    accounts: [],
    transactions: [],
    batches: [],
    categories: [],
    rules: [],
    budgets: [],
    sequence: 0,
  };
}

let state = emptyState();
state = seed(today());

// ── helpers ─────────────────────────────────────────────────────────────────────────────

function today(): ExportDay {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function nextId(prefix: string): string {
  state.sequence += 1;
  return `demo-${prefix}-${String(state.sequence)}`;
}

/** Strictly increasing, so the tie-break on `createdAt` is the order things were made in. */
function stamp(): string {
  state.sequence += 1;
  return new Date(Date.now() + state.sequence).toISOString();
}

/** A copy, so nothing the UI holds can reach back into the store. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/** Resolved on a later task, as a network answer would be — never in the caller's own tick. */
function answer<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(copy(value));
    }, 0);
  });
}

function refuse(error: Error): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(error);
    }, 0);
  });
}

/** Runs `work` and turns a throw into a rejection, so every function is async-shaped. */
function run<T>(work: () => T): Promise<T> {
  try {
    return answer(work());
  } catch (error) {
    return refuse(error instanceof Error ? error : new Error(String(error)));
  }
}

function toTransactionPayload(row: StoredTransaction): TransactionPayload {
  const { accountId: _account, batchId: _batch, deletedAt: _deleted, ...payload } = row;
  return payload;
}

function toRulePayload(rule: Rule): RulePayload {
  const { createdAt: _createdAt, ...payload } = rule;
  return payload;
}

function toCategoryPayload(category: StoredCategory): CategoryPayload {
  const { createdAt: _createdAt, ...payload } = category;
  return payload;
}

function requireCategory(categoryId: string): StoredCategory {
  const category = state.categories.find((candidate) => candidate.id === categoryId);
  if (category === undefined) {
    throw new Error(`No category ${categoryId}`);
  }
  return category;
}

function requireRule(ruleId: string): Rule {
  const rule = state.rules.find((candidate) => candidate.id === ruleId);
  if (rule === undefined) {
    throw new Error(`No rule ${ruleId}`);
  }
  return rule;
}

function parseRule(body: unknown): RuleInput {
  const parsed = parseRuleInput(body);
  if (!parsed.ok) {
    throw new ApiError('RULE_INVALID', [], { code: 'RULE_INVALID', errors: parsed.errors });
  }
  return parsed.rule;
}

function requireMonth(month: string): void {
  if (!isMonthKey(month)) {
    const errors = [{ code: 'MONTH_INVALID', field: 'month' }];
    throw new ApiError('BUDGET_INVALID', [], { code: 'BUDGET_INVALID', errors });
  }
}

function replace<T extends { readonly id: string }>(list: T[], next: T): void {
  const index = list.findIndex((item) => item.id === next.id);
  list[index] = next;
}

// ── the engine, as RuleService.applyAll runs it ─────────────────────────────────────────

/**
 * Every active rule over every row nobody set by hand, writing `null` as well as matches —
 * a category never outlives the rule that explains it.
 */
function applyAll(): ApplySummary {
  const ordered = orderRules(state.rules);
  let evaluated = 0;
  let assigned = 0;
  let cleared = 0;
  let locked = 0;

  state.transactions = state.transactions.map((row) => {
    if (row.categoryLockedAt !== null) {
      locked += 1;
      return row;
    }
    evaluated += 1;
    const categoryId = matchingRule(ordered, row)?.categoryId ?? null;
    if (categoryId === row.categoryId) {
      return row;
    }
    if (categoryId === null) {
      cleared += 1;
    } else {
      assigned += 1;
    }
    return { ...row, categoryId };
  });

  return { evaluated, assigned, cleared, locked };
}

function appendRule(input: RuleInput): Rule {
  const last = state.rules.reduce<number | undefined>(
    (max, rule) => (max === undefined ? rule.priority : Math.max(max, rule.priority)),
    undefined,
  );
  const rule: Rule = {
    ...input,
    priority: last === undefined ? DEFAULT_RULE_PRIORITY : last + PRIORITY_STEP,
    id: nextId('rule'),
    createdAt: stamp(),
  };
  state.rules.push(rule);
  return rule;
}

function addCategory(name: string): StoredCategory {
  const category: StoredCategory = {
    id: nextId('category'),
    name,
    colorIndex: state.categories.length % CATEGORY_COLOR_COUNT,
    createdAt: stamp(),
  };
  state.categories.push(category);
  return category;
}

// ── the seed ────────────────────────────────────────────────────────────────────────────

/**
 * The household the README shows: six months imported, six categories with their rules,
 * three months of limits, rules applied. Built through the same steps a user would take.
 */
function seed(end: ExportDay): State {
  state = emptyState();
  state.accounts = [{ id: 'demo-account', iban: DEMO_IBAN, name: DEMO_ACCOUNT_NAME }];

  const rows = bookings(end);
  const batchId = 'demo-import';
  state.transactions = rows.map((booking, index) => ({
    id: `demo-tx-${String(index + 1)}`,
    accountId: 'demo-account',
    batchId,
    deletedAt: null,
    bookingDate: booking.date,
    valueDate: booking.date,
    amountCents: booking.cents,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: booking.payee,
    counterpartyIban: null,
    purpose: booking.purpose,
    bookingText: booking.text,
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
  }));
  state.batches = [
    {
      id: batchId,
      accountId: 'demo-account',
      fileName: DEMO_FILE_NAME,
      // As the README capture uploads it: the same household, written out as UTF-8.
      encoding: 'utf-8',
      dialect: 'sparkasse-camt',
      importedAt: stamp(),
      rowsParsed: rows.length,
      rowsImported: rows.length,
      rowsSkipped: 0,
      rowsRestored: 0,
      rowsFailed: 0,
      undoneAt: null,
    },
  ];

  for (const [name, keywords, limit] of DEMO_SETUP) {
    const category = addCategory(name);
    for (const value of keywords) {
      appendRule(
        parseRule({
          field: 'counterpartyName',
          operator: 'contains',
          value,
          categoryId: category.id,
        }),
      );
    }
    for (const month of budgetMonths(end)) {
      state.budgets.push({ categoryId: category.id, month, amountCents: limit });
    }
  }
  applyAll();
  return state;
}

/** Back to the seed, as a reload does. For tests. */
export function resetDemo(end: ExportDay = today()): void {
  state = seed(end);
}

// ── accounts and transactions ───────────────────────────────────────────────────────────

export function listAccounts(_signal?: AbortSignal): Promise<AccountPayload[]> {
  return run(() => [...state.accounts].sort((a, b) => a.name.localeCompare(b.name)));
}

export function createAccount(iban: string, name: string): Promise<AccountPayload> {
  return run(() => {
    const normalized = iban.trim().replaceAll(' ', '').toUpperCase();
    if (normalized === '') {
      throw new Error('iban is required');
    }
    if (!isValidIban(normalized)) {
      throw new ApiError('IBAN_INVALID', [], { code: 'IBAN_INVALID' });
    }
    if (name.trim() === '') {
      throw new Error('name is required');
    }
    if (state.accounts.some((account) => account.iban === normalized)) {
      throw new Error(`An account for ${normalized} already exists`);
    }
    const account = { id: nextId('account'), iban: normalized, name: name.trim() };
    state.accounts.push(account);
    return account;
  });
}

export function listTransactions(
  accountId: string,
  _signal?: AbortSignal,
): Promise<TransactionPayload[]> {
  return run(() => {
    if (!state.accounts.some((account) => account.id === accountId)) {
      throw new Error(`No account ${accountId}`);
    }
    return state.transactions
      .filter((row) => row.accountId === accountId && row.deletedAt === null)
      .map(toTransactionPayload);
  });
}

/** As `AccountService.setTransactionCategory`: a hand-set category locks the row. */
export function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<TransactionPayload> {
  return run(() => {
    const row = state.transactions.find((candidate) => candidate.id === transactionId);
    if (row === undefined || row.deletedAt !== null) {
      throw new Error(`No transaction ${transactionId}`);
    }
    if (row.status === 'pending') {
      throw new ApiError('TRANSACTION_PENDING', [], { code: 'TRANSACTION_PENDING' });
    }
    if (categoryId !== null) {
      requireCategory(categoryId);
    }
    const next: StoredTransaction = {
      ...row,
      categoryId,
      categoryLockedAt: categoryId === null ? null : stamp(),
    };
    replace(state.transactions, next);
    return toTransactionPayload(next);
  });
}

// ── imports ─────────────────────────────────────────────────────────────────────────────

export function listImports(_signal?: AbortSignal): Promise<ImportBatchPayload[]> {
  return run(() => [...state.batches].sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
}

/** The demo reads no files: the CSV parser is Node-only, and the rows are already here. */
export function uploadImport(_accountId: string, _file: File): Promise<ImportSummary> {
  return refuse(new ApiError('DEMO_READ_ONLY', [], { code: 'DEMO_READ_ONLY' }));
}

function requireBatch(batchId: string): ImportBatchPayload {
  const batch = state.batches.find((candidate) => candidate.id === batchId);
  if (batch === undefined) {
    throw new Error(`No import ${batchId}`);
  }
  return batch;
}

/** As `ImportService.undo`, newest standing upload of its account only; locks are released. */
export function undoImport(batchId: string): Promise<ImportBatchPayload> {
  return run(() => {
    const batch = requireBatch(batchId);
    if (batch.undoneAt !== null) {
      return batch;
    }
    const newer = state.batches.some(
      (other) =>
        other.accountId === batch.accountId &&
        other.undoneAt === null &&
        other.importedAt > batch.importedAt,
    );
    if (newer) {
      throw new ApiError('IMPORT_NOT_LATEST', [], { code: 'IMPORT_NOT_LATEST' });
    }
    const undoneAt = stamp();
    state.transactions = state.transactions.map((row) =>
      row.batchId === batchId && row.deletedAt === null
        ? { ...row, deletedAt: undoneAt, categoryLockedAt: null }
        : row,
    );
    const next = { ...batch, undoneAt };
    replace(state.batches, next);
    return next;
  });
}

/** As `ImportService.restore`: the same rows come back, the most recent removal first. */
export function restoreImport(batchId: string): Promise<ImportBatchPayload> {
  return run(() => {
    const batch = requireBatch(batchId);
    const { undoneAt } = batch;
    if (undoneAt === null) {
      return batch;
    }
    const later = state.batches.some(
      (other) =>
        other.accountId === batch.accountId && other.undoneAt !== null && other.undoneAt > undoneAt,
    );
    if (later) {
      throw new ApiError('IMPORT_RESTORE_BLOCKED', [], { code: 'IMPORT_RESTORE_BLOCKED' });
    }
    state.transactions = state.transactions.map((row) =>
      row.batchId === batchId && row.deletedAt === undoneAt ? { ...row, deletedAt: null } : row,
    );
    const next = { ...batch, undoneAt: null };
    replace(state.batches, next);
    return next;
  });
}

// ── categories ──────────────────────────────────────────────────────────────────────────

/** As `CategoryService.assertNameFree`: `Wohnen` and `wohnen` cannot both exist. */
function assertNameFree(name: string, exceptId?: string): void {
  const wanted = normalize(name);
  const clash = state.categories.find(
    (category) => category.id !== exceptId && normalize(category.name) === wanted,
  );
  if (clash !== undefined) {
    throw new Error(`A category named ${clash.name} already exists`);
  }
}

export function listCategories(_signal?: AbortSignal): Promise<CategoryPayload[]> {
  return run(() =>
    [...state.categories]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(toCategoryPayload),
  );
}

export function createCategory(name: string): Promise<CategoryPayload> {
  return run(() => {
    const trimmed = name.trim();
    if (trimmed === '') {
      throw new Error('name is required');
    }
    assertNameFree(trimmed);
    return toCategoryPayload(addCategory(trimmed));
  });
}

export function updateCategory(
  categoryId: string,
  update: { readonly name?: string; readonly colorIndex?: number },
): Promise<CategoryPayload> {
  return run(() => {
    const existing = requireCategory(categoryId);
    const name = update.name?.trim();
    if (name === '') {
      throw new Error('name is required');
    }
    const { colorIndex } = update;
    if (
      colorIndex !== undefined &&
      !(Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < CATEGORY_COLOR_COUNT)
    ) {
      throw new ApiError('CATEGORY_COLOR_INVALID', [], { code: 'CATEGORY_COLOR_INVALID' });
    }
    if (name !== undefined) {
      assertNameFree(name, categoryId);
    }
    const next = {
      ...existing,
      name: name ?? existing.name,
      colorIndex: colorIndex ?? existing.colorIndex,
    };
    replace(state.categories, next);
    return toCategoryPayload(next);
  });
}

/** Refused while anything points at it, with the counts that explain why. */
export function deleteCategory(categoryId: string): Promise<void> {
  return run(() => {
    requireCategory(categoryId);
    const rules = state.rules.filter((rule) => rule.categoryId === categoryId).length;
    const transactions = state.transactions.filter(
      (row) => row.categoryId === categoryId && row.deletedAt === null,
    ).length;
    const budgets = state.budgets.filter((budget) => budget.categoryId === categoryId).length;
    if (rules > 0 || transactions > 0 || budgets > 0) {
      const details = { code: 'CATEGORY_IN_USE', rules, transactions, budgets };
      throw new ApiError('CATEGORY_IN_USE', [], details);
    }
    state.transactions = state.transactions.map((row) =>
      row.categoryId === categoryId ? { ...row, categoryId: null, categoryLockedAt: null } : row,
    );
    state.categories = state.categories.filter((category) => category.id !== categoryId);
  });
}

// ── rules ───────────────────────────────────────────────────────────────────────────────

function rulesInOrder(): RulePayload[] {
  return [...state.rules].sort(compareRules).map(toRulePayload);
}

export function listRules(_signal?: AbortSignal): Promise<RulePayload[]> {
  return run(rulesInOrder);
}

/** Without a `priority` the rule is appended after every rule there is. */
export function createRule(input: RuleInput | Omit<RuleInput, 'priority'>): Promise<RulePayload> {
  return run(() => {
    const parsed = parseRule(input);
    requireCategory(parsed.categoryId);
    if ((input as { readonly priority?: unknown }).priority !== undefined) {
      const rule: Rule = { ...parsed, id: nextId('rule'), createdAt: stamp() };
      state.rules.push(rule);
      return toRulePayload(rule);
    }
    return toRulePayload(appendRule(parsed));
  });
}

export function updateRule(ruleId: string, input: RuleInput): Promise<RulePayload> {
  return run(() => {
    const existing = requireRule(ruleId);
    const parsed = parseRule({ ...toRulePayload(existing), ...input });
    requireCategory(parsed.categoryId);
    const next: Rule = { ...existing, ...parsed };
    replace(state.rules, next);
    return toRulePayload(next);
  });
}

export function reorderRules(ids: readonly string[]): Promise<RulePayload[]> {
  return run(() => {
    if (new Set(ids).size !== ids.length) {
      throw new ApiError('RULE_ORDER_INVALID', [], { code: 'RULE_ORDER_INVALID' });
    }
    const known = new Set(state.rules.map((rule) => rule.id));
    if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
      throw new ApiError('RULE_ORDER_STALE', [], { code: 'RULE_ORDER_STALE' });
    }
    state.rules = state.rules.map((rule) => ({
      ...rule,
      priority: (ids.indexOf(rule.id) + 1) * PRIORITY_STEP,
    }));
    return rulesInOrder();
  });
}

export function deleteRule(ruleId: string): Promise<DeletedRulePayload> {
  return run(() => {
    const rule = requireRule(ruleId);
    state.rules = state.rules.filter((candidate) => candidate.id !== ruleId);
    return rule;
  });
}

/** Same id, same `createdAt`, so the same place in the order. */
export function restoreRule(rule: DeletedRulePayload): Promise<RulePayload> {
  return run(() => {
    if (Number.isNaN(Date.parse(rule.createdAt)) || rule.id.trim() === '') {
      throw new ApiError('RULE_RESTORE_INVALID', [], { code: 'RULE_RESTORE_INVALID' });
    }
    const parsed = parseRule(rule);
    requireCategory(parsed.categoryId);
    if (state.rules.some((candidate) => candidate.id === rule.id)) {
      throw new ApiError('RULE_EXISTS', [], { code: 'RULE_EXISTS' });
    }
    const restored: Rule = { ...parsed, id: rule.id, createdAt: rule.createdAt };
    state.rules.push(restored);
    return toRulePayload(restored);
  });
}

export function applyRules(): Promise<ApplySummary> {
  return run(applyAll);
}

// ── budgets ─────────────────────────────────────────────────────────────────────────────

export function listBudgets(month: string, _signal?: AbortSignal): Promise<BudgetPayload[]> {
  return run(() => {
    requireMonth(month);
    return state.budgets
      .filter((budget) => budget.month === month)
      .sort((a, b) => a.categoryId.localeCompare(b.categoryId));
  });
}

export function setBudget(
  month: string,
  categoryId: string,
  amountCents: number,
): Promise<BudgetPayload> {
  return run(() => {
    const parsed = parseBudgetInput({ amountCents, month, categoryId });
    if (!parsed.ok) {
      throw new ApiError('BUDGET_INVALID', [], { code: 'BUDGET_INVALID', errors: parsed.errors });
    }
    requireCategory(categoryId);
    const budget = { ...parsed.budget };
    state.budgets = [
      ...state.budgets.filter((b) => !(b.month === month && b.categoryId === categoryId)),
      budget,
    ];
    return budget;
  });
}

export function clearBudget(month: string, categoryId: string): Promise<void> {
  return run(() => {
    requireMonth(month);
    state.budgets = state.budgets.filter(
      (budget) => !(budget.month === month && budget.categoryId === categoryId),
    );
  });
}
