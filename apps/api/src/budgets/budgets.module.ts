import { Module } from '@nestjs/common';

import { RulesModule } from '../rules/rules.module.js';
import { BudgetController } from './budget.controller.js';
import { BudgetService } from './budget.service.js';

/** `RulesModule` for `CategoryService`: a budget for a category that does not exist 404s. */
@Module({
  imports: [RulesModule],
  controllers: [BudgetController],
  providers: [BudgetService],
})
export class BudgetsModule {}
