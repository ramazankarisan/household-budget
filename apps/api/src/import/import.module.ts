import { Module } from '@nestjs/common';

import { AccountModule } from '../accounts/account.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

@Module({
  // RulesModule: an import categorizes the rows it inserts, in its own transaction.
  imports: [AccountModule, RulesModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
