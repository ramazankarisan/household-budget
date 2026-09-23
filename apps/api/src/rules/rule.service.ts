import {
  ApplySummary,
  categorize,
  compareRules,
  MatchableTransaction,
  orderRules,
  parseRuleInput,
  Rule as CoreRule,
  RuleField,
  RuleOperator,
  RulePayload,
} from '@household-budget/core';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from './category.service.js';

/**
 * What an apply is allowed to write with. `$transaction`'s client is the same shape as
 * `PrismaService` minus the methods that would nest a transaction inside one, which is
 * why this is a `Pick` rather than the client type.
 */
export type RuleTransactionClient = Pick<PrismaService, 'transaction' | 'rule'>;

/** The columns an apply reads. Only these: the row set is the whole database. */
interface CategorizableRow extends MatchableTransaction {
  readonly id: string;
  readonly categoryId: string | null;
}

/** A stored rule row, as Prisma hands it back. Widened to core's unions at the edge. */
interface RuleRow {
  id: string;
  field: string;
  operator: string;
  value: string;
  priority: number;
  categoryId: string;
  active: boolean;
  createdAt: Date;
}

/**
 * The database column is a plain `String` — SQLite has no enums — so the union is
 * re-asserted on the way out. Nothing but `parseRuleInput` ever writes these columns,
 * which is what makes the assertion safe rather than hopeful.
 */
export function toCoreRule(row: RuleRow): CoreRule {
  return {
    id: row.id,
    field: row.field as RuleField,
    operator: row.operator as RuleOperator,
    value: row.value,
    priority: row.priority,
    categoryId: row.categoryId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `createdAt` exists to break a priority tie; the UI has no use for it. */
function stripCreatedAt(rule: CoreRule): RulePayload {
  const { createdAt: _createdAt, ...payload } = rule;
  return payload;
}

function toPayload(row: RuleRow): RulePayload {
  return stripCreatedAt(toCoreRule(row));
}

/**
 * Rules: stored, validated and handed out in the order they will be applied.
 *
 * Validation is `parseRuleInput` in `packages/core`, not a Nest pipe, because the browser
 * runs the same function before it submits. This service's own job is the part core
 * cannot do — checking that the category exists, and persisting.
 */
@Injectable()
export class RuleService {
  private readonly logger = new Logger(RuleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryService,
  ) {}

  /**
   * Every rule, switched-off ones included, in the order the engine will walk them.
   *
   * Sorted with core's own comparator rather than by SQL: the list the user reads and
   * the sequence that decides a category have to be the same sequence, and a rule the
   * user switched off still has to be on screen to be switched back on.
   */
  async list(): Promise<RulePayload[]> {
    const rows = await this.prisma.rule.findMany();
    return rows.map(toCoreRule).sort(compareRules).map(stripCreatedAt);
  }

  async create(body: unknown): Promise<RulePayload> {
    const input = this.parse(body);
    await this.categories.requireCategory(input.categoryId);

    const created = await this.prisma.rule.create({ data: input });
    this.logger.log(`create rule=${created.id} field=${created.field}`);
    return toPayload(created);
  }

  async update(ruleId: string, body: unknown): Promise<RulePayload> {
    await this.requireRule(ruleId);
    const input = this.parse(body);
    await this.categories.requireCategory(input.categoryId);

    const updated = await this.prisma.rule.update({ where: { id: ruleId }, data: input });
    this.logger.log(`update rule=${updated.id} field=${updated.field}`);
    return toPayload(updated);
  }

  async remove(ruleId: string): Promise<void> {
    await this.requireRule(ruleId);
    await this.prisma.rule.delete({ where: { id: ruleId } });
    // A deleted rule leaves the categories it assigned behind until the next apply
    // clears them, which is why an apply writes null as well as matches.
    this.logger.log(`delete rule=${ruleId}`);
  }

  /** Throws rather than returning null: every caller here needs the rule to exist. */
  async requireRule(ruleId: string): Promise<RulePayload> {
    const rule = await this.prisma.rule.findUnique({ where: { id: ruleId } });
    if (rule === null) {
      throw new NotFoundException(`No rule ${ruleId}`);
    }
    return toPayload(rule);
  }

  /**
   * Runs every active rule over every row the user has not decided by hand.
   *
   * Global on purpose: rules are global, so a per-account apply would leave the other
   * accounts silently stale with no way to tell. Soft-deleted rows are included because a
   * re-import restores them in place, and a restored row that had skipped every apply
   * would come back uncategorized.
   *
   * `client` is passed when an import calls this inside its own `$transaction`; without
   * one this opens its own, so the whole rewrite lands or none of it does.
   */
  async applyAll(client?: RuleTransactionClient): Promise<ApplySummary> {
    if (client === undefined) {
      return this.prisma.$transaction((tx) => this.applyAll(tx));
    }

    const ordered = orderRules((await client.rule.findMany()).map(toCoreRule));
    const locked = await client.transaction.count({ where: { categoryLockedAt: { not: null } } });

    /*
     * No early return when there are no active rules. An unlocked row's category is
     * there because a rule put it there, so with every rule deleted or switched off the
     * honest result is that nothing is categorized any more — and clearing is what keeps
     * a category from outliving the rule that explains it. Hand-set rows are locked and
     * are never loaded below, so this cannot reach them.
     */
    const rows = await client.transaction.findMany({
      where: { categoryLockedAt: null },
      select: {
        id: true,
        categoryId: true,
        counterpartyName: true,
        purpose: true,
        counterpartyIban: true,
      },
    });

    const { assign, clear } = this.plan(ordered, rows);
    await this.write(client, assign, clear);

    const assigned = [...assign.values()].reduce((total, ids) => total + ids.length, 0);
    this.logger.log(
      `apply rules=${String(ordered.length)} evaluated=${String(rows.length)} ` +
        `assigned=${String(assigned)} cleared=${String(clear.length)} locked=${String(locked)}`,
    );

    return { evaluated: rows.length, assigned, cleared: clear.length, locked };
  }

  /**
   * Categorizes a known set of rows — the ones an import just inserted or restored —
   * using the same engine, inside the import's own transaction. Returns how many it
   * categorized.
   *
   * Scoped to those ids rather than running a full apply: an import must not quietly
   * rewrite rows that were already stored, and a full apply inside every upload would.
   */
  async applyToRows(client: RuleTransactionClient, rowIds: readonly string[]): Promise<number> {
    if (rowIds.length === 0) {
      return 0;
    }

    const ordered = orderRules((await client.rule.findMany()).map(toCoreRule));
    if (ordered.length === 0) {
      return 0;
    }

    const rows = await client.transaction.findMany({
      where: { id: { in: [...rowIds] }, categoryLockedAt: null },
      select: {
        id: true,
        categoryId: true,
        counterpartyName: true,
        purpose: true,
        counterpartyIban: true,
      },
    });

    const { assign } = this.plan(ordered, rows);
    // No clearing here: these rows are new or restored, so there is nothing stale to
    // clear, and a restored row's own category is the one it should come back with.
    await this.write(client, assign, []);

    return [...assign.values()].reduce((total, ids) => total + ids.length, 0);
  }

  /**
   * Which rows change, and to what.
   *
   * Rows already holding the value they would be given are excluded from both
   * collections — that exclusion is the whole reason a second identical apply reports
   * zero and writes nothing.
   */
  private plan(
    ordered: readonly CoreRule[],
    rows: readonly CategorizableRow[],
  ): { assign: Map<string, string[]>; clear: string[] } {
    const assign = new Map<string, string[]>();
    const clear: string[] = [];

    for (const row of rows) {
      const categoryId = categorize(ordered, row);

      if (categoryId === undefined) {
        // A category no rule claims any more — the rule was deleted or edited — is
        // cleared rather than left orphaned.
        if (row.categoryId !== null) {
          clear.push(row.id);
        }
        continue;
      }
      if (categoryId === row.categoryId) {
        continue;
      }

      const ids = assign.get(categoryId);
      if (ids === undefined) {
        assign.set(categoryId, [row.id]);
      } else {
        ids.push(row.id);
      }
    }

    return { assign, clear };
  }

  /**
   * One `updateMany` per resulting category, plus one for the cleared rows: O(categories)
   * statements, not O(rows). Verified on this checkout that Prisma 7 with the
   * better-sqlite3 adapter handles an `id: { in: [...] }` of 40 000 ids despite SQLite's
   * 32 766 bound-parameter ceiling — it chunks internally, so there is no batching here.
   */
  private async write(
    client: RuleTransactionClient,
    assign: ReadonlyMap<string, readonly string[]>,
    clear: readonly string[],
  ): Promise<void> {
    for (const [categoryId, ids] of assign) {
      await client.transaction.updateMany({
        where: { id: { in: [...ids] } },
        // categoryLockedAt stays null: a rule assigned this, so a rule may change it.
        data: { categoryId },
      });
    }

    if (clear.length > 0) {
      await client.transaction.updateMany({
        where: { id: { in: [...clear] } },
        data: { categoryId: null },
      });
    }
  }

  /**
   * Never logs the rule's `value`: a keyword is a fragment of a payee name, which is the
   * user's spending history. The code and the form field are enough to fix the form.
   */
  private parse(body: unknown) {
    const parsed = parseRuleInput(body);
    if (!parsed.ok) {
      throw new BadRequestException({ code: 'RULE_INVALID', errors: parsed.errors });
    }
    return parsed.rule;
  }
}
