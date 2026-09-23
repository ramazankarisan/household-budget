import { BudgetPayload, isMonthKey, parseBudgetInput } from '@household-budget/core';
import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from '../rules/category.service.js';

/**
 * The limits set for a month.
 *
 * One row per category per month, household-wide, and nothing is inherited: a month
 * nobody has budgeted is empty until it is typed in. That is the only rule with a single
 * state on screen — inheritance would put another month's number in front of the user,
 * and copy-forward would need a button, a "did it run" flag, and an answer for what
 * happens when last month is edited afterwards.
 *
 * Validation is `parseBudgetInput` from `packages/core`, the same function the browser
 * runs before it submits, so a refusal here is one the form could already explain.
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryService,
  ) {}

  /**
   * The limits for one month, empty when none are set.
   *
   * Ordered by category id so two calls agree; the UI sorts by the category's name, which
   * it holds and this does not.
   */
  async list(month: string): Promise<BudgetPayload[]> {
    this.requireMonth(month);

    const budgets = await this.prisma.budget.findMany({
      where: { month },
      orderBy: { categoryId: 'asc' },
    });

    return budgets.map((budget) => ({
      categoryId: budget.categoryId,
      month: budget.month,
      amountCents: budget.amountCents,
    }));
  }

  /**
   * Sets one cell, whether or not it was set before.
   *
   * `PUT` and an upsert rather than a create and a patch: the UI would otherwise have to
   * know which of the two this cell needs, and a spreadsheet cell being typed into is the
   * definition of an idempotent write. `requireCategory` is what 404s a limit for a
   * category that does not exist — no second existence check.
   */
  async set(month: string, categoryId: string, body: unknown): Promise<BudgetPayload> {
    const source = typeof body === 'object' && body !== null ? body : {};
    const parsed = parseBudgetInput({ ...source, month, categoryId });
    if (!parsed.ok) {
      throw new BadRequestException({ code: 'BUDGET_INVALID', errors: parsed.errors });
    }
    await this.categories.requireCategory(parsed.budget.categoryId);

    const saved = await this.prisma.budget.upsert({
      where: {
        categoryId_month: { categoryId: parsed.budget.categoryId, month: parsed.budget.month },
      },
      create: parsed.budget,
      update: { amountCents: parsed.budget.amountCents },
    });

    return { categoryId: saved.categoryId, month: saved.month, amountCents: saved.amountCents };
  }

  /**
   * Clears one cell. Clearing a limit that was never set is a success, the posture
   * `softDeleteTransaction` takes: the caller asked for a state, and the state holds.
   */
  async remove(month: string, categoryId: string): Promise<void> {
    this.requireMonth(month);

    await this.prisma.budget.deleteMany({ where: { month, categoryId } });
  }

  /**
   * A path segment that is not a month is refused in the shape a body would be, so the
   * browser has one error payload to read rather than two. `'2025-9'` reaching a `WHERE`
   * clause matches nothing and reads as "no budgets set", which is the wrong answer told
   * convincingly.
   */
  private requireMonth(month: string): void {
    if (!isMonthKey(month)) {
      throw new BadRequestException({
        code: 'BUDGET_INVALID',
        errors: [{ code: 'MONTH_INVALID', field: 'month' }],
      });
    }
  }
}
