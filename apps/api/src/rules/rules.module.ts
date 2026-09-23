import { Module } from '@nestjs/common';

import { CategoryController } from './category.controller.js';
import { CategoryService } from './category.service.js';
import { RuleController } from './rule.controller.js';
import { RuleService } from './rule.service.js';

@Module({
  controllers: [CategoryController, RuleController],
  providers: [CategoryService, RuleService],
  // ImportModule categorizes the rows it inserts, inside its own transaction.
  exports: [RuleService, CategoryService],
})
export class RulesModule {}
