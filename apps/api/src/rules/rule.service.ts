import {
  ApplySummary,
  compareRules,
  DeletedRulePayload,
  MatchableTransaction,
  matchingRule,
  orderRules,
  parseRuleInput,
  Rule as CoreRule,
  RuleField,
  RuleOperator,
  RulePayload,
} from '@household-budget/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from './category.service.js';

/** Prisma's code for a unique-constraint violation; here, a rule id restored twice. */
const UNIQUE_CONSTRAINT = 'P2002';

/**
 * What an apply is allowed to write with. `$transaction`'s client is the same shape as
 * `PrismaService` minus the methods that would nest a transaction inside one, which is
 * why this is a `Pick` rather than the client type.
 */
export type RuleTransactionClient = Pick<PrismaService, 'transaction' | 'rule'>;

/**
 * An apply reads every unlocked row and writes one statement per category, all inside one
 * interactive transaction. Prisma's default budget for those is 5 s, which is the JS
 * matching cost (measured at 27 ms for 50 000 rows × 20 rules) plus SQLite round trips
 * that were never measured — so on a long history the default fails with P2028 and
 * applies nothing. Stated explicitly rather than inherited.
 */
const APPLY_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/** A body worth merging a stored rule with. Arrays and `null` are not. */
function isObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** The stored rule as an update body: every field a `parseRuleInput` reads, and no id. */
function toRuleInput(rule: RulePayload): Record<string, unknown> {
  return {
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    priority: rule.priority,
    categoryId: rule.categoryId,
    active: rule.active,
  };
}

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
    const existing = await this.requireRule(ruleId);
    /*
     * The body is merged over the stored rule and the result validated as a whole, rather
     * than validated on its own and written.
     *
     * `parseRuleInput` fills in what a body leaves out with what a *create* should mean —
     * `active: true`, `priority: 100` — and on an update those defaults are decisions the
     * user never made. A body that omits `active` would switch a rule they disabled back
     * on; one that omits `priority` would move a rule from 10 to 100, which is a rule that
     * used to win a tie and now loses it, re-categorizing every row it owned on the next
     * apply with nothing on screen to explain it. Merging first means an absent field
     * keeps the stored value and a present one is still validated.
     *
     * A body that is not an object at all is passed through untouched, so it is rejected
     * as `RULE_INVALID` rather than quietly re-saving the rule unchanged.
     */
    const merged = isObject(body) ? { ...toRuleInput(existing), ...body } : body;
    const input = this.parse(merged);
    await this.categories.requireCategory(input.categoryId);

    const updated = await this.prisma.rule.update({
      where: { id: ruleId },
      data: input,
    });
    this.logger.log(`update rule=${updated.id} field=${updated.field}`);
    return toPayload(updated);
  }

  /**
   * Returns the rule as it stood, `createdAt` included, so the UI can offer an undo that
   * puts it back exactly — see {@link restore}.
   */
  async remove(ruleId: string): Promise<DeletedRulePayload> {
    const row = await this.prisma.rule.findUnique({ where: { id: ruleId } });
    if (row === null) {
      throw new NotFoundException(`No rule ${ruleId}`);
    }
    await this.prisma.rule.delete({ where: { id: ruleId } });
    // A deleted rule leaves the categories it assigned behind until the next apply
    // clears them, which is why an apply writes null as well as matches.
    this.logger.log(`delete rule=${ruleId}`);
    return toCoreRule(row);
  }

  /**
   * Puts a deleted rule back with its own id and `createdAt`, so it sorts exactly where it
   * did. A plain create would stamp it now and move it behind every rule of equal
   * priority — a different rule could then win the tie on the next apply, with nothing
   * on screen to say why.
   *
   * The rule itself is validated by `parseRuleInput`, like any create. Refused when the
   * id is taken again (restored twice) or its category has gone in the meantime.
   */
  async restore(body: unknown): Promise<RulePayload> {
    const source = isObject(body) ? body : {};
    const { id, createdAt } = source;
    const stamp = typeof createdAt === 'string' ? new Date(createdAt) : undefined;
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      stamp === undefined ||
      Number.isNaN(stamp.getTime())
    ) {
      throw new BadRequestException({ code: 'RULE_RESTORE_INVALID' });
    }
    const input = this.parse(body);
    await this.categories.requireCategory(input.categoryId);
    /*
     * No look-before-insert: two restores of the same rule (two tabs, a retried request)
     * could both pass a check and the second would fail on the primary key as a 500. The
     * insert is the check, and its unique-constraint error is the 409.
     */
    try {
      const restored = await this.prisma.rule.create({ data: { ...input, id, createdAt: stamp } });
      this.logger.log(`restore rule=${restored.id} field=${restored.field}`);
      return toPayload(restored);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT) {
        throw new ConflictException({ code: 'RULE_EXISTS' });
      }
      throw error;
    }
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
      return this.prisma.$transaction((tx) => this.applyAll(tx), APPLY_TRANSACTION_OPTIONS);
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

    const { assign, clear, matched } = this.plan(ordered, rows);
    const { assigned, cleared } = await this.write(client, assign, clear);

    this.logger.log(
      `apply rules=${String(ordered.length)} evaluated=${String(rows.length)} ` +
        `assigned=${String(assigned)} cleared=${String(cleared)} locked=${String(locked)}`,
    );
    /*
     * A line per rule, zeroes included. First match wins, so a rule can be perfectly
     * valid and still decide nothing — either because a lower priority got there first or
     * because the keyword is wrong — and the aggregate above cannot tell those apart.
     * Never the rule's `value`: see the note on `parse`.
     */
    for (const rule of ordered) {
      this.logger.log(
        `apply rule=${rule.id} field=${rule.field} matched=${String(matched.get(rule.id) ?? 0)}`,
      );
    }

    return { evaluated: rows.length, assigned, cleared, locked };
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

    // No early return on an empty rule set, for the same reason applyAll has none: a
    // restored row may carry a category no rule explains any more.
    const ordered = orderRules((await client.rule.findMany()).map(toCoreRule));

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

    const { assign, clear } = this.plan(ordered, rows);
    /*
     * Clears as well as assigns. A restored row is an *old* row: it can still hold a
     * category written by a rule that has since been deleted or edited, and letting that
     * come back would leave a category the next apply strips — visibly changing on its
     * own, with nothing on screen to explain it. A freshly inserted row holds null, so
     * it is never in `clear`; this only ever touches the restored ones.
     */
    const { assigned } = await this.write(client, assign, clear);

    return assigned;
  }

  /**
   * Which rows change, and to what — plus how many rows each rule claimed.
   *
   * Rows already holding the value they would be given are excluded from both
   * collections — that exclusion is the whole reason a second identical apply reports
   * zero and writes nothing. `matched` is not that: it counts every row a rule claimed,
   * including the ones already in its category, because "your rule matched nothing" and
   * "your rule matched 214 rows that were already there" are different answers to the
   * same question.
   */
  private plan(
    ordered: readonly CoreRule[],
    rows: readonly CategorizableRow[],
  ): { assign: Map<string, string[]>; clear: string[]; matched: Map<string, number> } {
    const assign = new Map<string, string[]>();
    const clear: string[] = [];
    const matched = new Map<string, number>();

    for (const row of rows) {
      const rule = matchingRule(ordered, row);

      if (rule === undefined) {
        // A category no rule claims any more — the rule was deleted or edited — is
        // cleared rather than left orphaned.
        if (row.categoryId !== null) {
          clear.push(row.id);
        }
        continue;
      }

      matched.set(rule.id, (matched.get(rule.id) ?? 0) + 1);
      if (rule.categoryId === row.categoryId) {
        continue;
      }

      const ids = assign.get(rule.categoryId);
      if (ids === undefined) {
        assign.set(rule.categoryId, [row.id]);
      } else {
        ids.push(row.id);
      }
    }

    return { assign, clear, matched };
  }

  /**
   * One `updateMany` per resulting category, plus one for the cleared rows: O(categories)
   * statements, not O(rows). Verified on this checkout that Prisma 7 with the
   * better-sqlite3 adapter handles an `id: { in: [...] }` of 40 000 ids despite SQLite's
   * 32 766 bound-parameter ceiling — it chunks internally, so there is no batching here.
   *
   * Returns what the database actually changed rather than what the plan intended, so a
   * row the lock guard below refused is not counted as assigned in the summary.
   */
  private async write(
    client: RuleTransactionClient,
    assign: ReadonlyMap<string, readonly string[]>,
    clear: readonly string[],
  ): Promise<{ assigned: number; cleared: number }> {
    let assigned = 0;
    let cleared = 0;

    for (const [categoryId, ids] of assign) {
      const written = await client.transaction.updateMany({
        // The lock is re-asserted here, not only in the read above. An apply reads
        // 40 000 rows and then writes them inside a budget of two minutes; a category
        // pinned by hand in between belongs to the user, and matching on the id alone
        // would overwrite it and leave the lock standing next to a category they never
        // chose. SQLite's own isolation may well refuse that write first — which is not a
        // reason for the invariant to live anywhere but in the statement that breaks it.
        where: { id: { in: [...ids] }, categoryLockedAt: null },
        // categoryLockedAt stays null: a rule assigned this, so a rule may change it.
        data: { categoryId },
      });
      assigned += written.count;
    }

    if (clear.length > 0) {
      const wiped = await client.transaction.updateMany({
        where: { id: { in: [...clear] }, categoryLockedAt: null },
        data: { categoryId: null },
      });
      cleared = wiped.count;
    }

    return { assigned, cleared };
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
