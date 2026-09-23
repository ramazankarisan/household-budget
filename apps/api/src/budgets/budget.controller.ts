import { BudgetPayload } from '@household-budget/core';
import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';

import { BudgetService } from './budget.service.js';

/**
 * Thin, and with no validation of its own: the month and the category are path segments
 * because a month is a natural one and `apps/api` has no `@Query` anywhere, and both go
 * to `parseBudgetInput` in `packages/core` — the same function the browser runs before
 * it submits.
 *
 * There is no `GET /api/budgets`: nothing needs every month at once, and a route that
 * returned one would be a payload growing by twelve rows a year for no reader.
 */
@Controller('budgets')
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  /** GET /api/budgets/:month — `[]` when the month has none. */
  @Get(':month')
  list(@Param('month') month: string): Promise<BudgetPayload[]> {
    return this.budgets.list(month);
  }

  /** PUT /api/budgets/:month/:categoryId — sets the cell whether or not it was set. */
  @Put(':month/:categoryId')
  set(
    @Param('month') month: string,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ): Promise<BudgetPayload> {
    return this.budgets.set(month, categoryId, body);
  }

  /** DELETE /api/budgets/:month/:categoryId — 204, and 204 again for a cell never set. */
  @Delete(':month/:categoryId')
  @HttpCode(204)
  remove(@Param('month') month: string, @Param('categoryId') categoryId: string): Promise<void> {
    return this.budgets.remove(month, categoryId);
  }
}
