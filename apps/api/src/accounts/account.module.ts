import { Module } from '@nestjs/common';

import { RulesModule } from '../rules/rules.module.js';
import { AccountController, TransactionController } from './account.controller.js';
import { AccountService } from './account.service.js';

@Module({
  // For CategoryService: a category set by hand still has to exist.
  imports: [RulesModule],
  controllers: [AccountController, TransactionController],
  providers: [AccountService],
  // ImportModule needs it to check that the target account exists before parsing.
  exports: [AccountService],
})
export class AccountModule {}
