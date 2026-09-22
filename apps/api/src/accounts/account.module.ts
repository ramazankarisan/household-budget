import { Module } from '@nestjs/common';

import { AccountController, TransactionController } from './account.controller.js';
import { AccountService } from './account.service.js';

@Module({
  controllers: [AccountController, TransactionController],
  providers: [AccountService],
  // ImportModule needs it to check that the target account exists before parsing.
  exports: [AccountService],
})
export class AccountModule {}
