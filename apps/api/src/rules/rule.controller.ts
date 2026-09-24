import { ApplySummary, DeletedRulePayload, RulePayload } from '@household-budget/core';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { RuleService } from './rule.service.js';

/**
 * Thin, and with no validation of its own: the body goes to `parseRuleInput` in
 * `packages/core`, which is the same function the browser runs before it submits.
 */
@Controller('rules')
export class RuleController {
  constructor(private readonly rules: RuleService) {}

  /** GET /api/rules — in the order they will be applied. */
  @Get()
  list(): Promise<RulePayload[]> {
    return this.rules.list();
  }

  /**
   * POST /api/rules/apply — no body. Rules are global, so applying them is a global act:
   * a per-account button would leave the other accounts stale with nothing on screen to
   * say so. Declared before `:id` routes so `apply` is never read as a rule id.
   */
  @Post('apply')
  @HttpCode(200)
  apply(): Promise<ApplySummary> {
    return this.rules.applyAll();
  }

  /** POST /api/rules/restore — a rule `DELETE` returned, put back with its id and `createdAt`. */
  @Post('restore')
  restore(@Body() body: unknown): Promise<RulePayload> {
    return this.rules.restore(body);
  }

  /** POST /api/rules */
  @Post()
  create(@Body() body: unknown): Promise<RulePayload> {
    return this.rules.create(body);
  }

  /** PATCH /api/rules/:id — a whole rule, not a partial one: every field is on the form. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<RulePayload> {
    return this.rules.update(id, body);
  }

  /**
   * DELETE /api/rules/:id — 200 with the rule as it stood, which is what an undo sends to
   * `restore`. The categories it assigned stay until the next apply.
   */
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string): Promise<DeletedRulePayload> {
    return this.rules.remove(id);
  }
}
