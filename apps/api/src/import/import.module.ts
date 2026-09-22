import { Module } from '@nestjs/common';

import { AccountModule } from '../accounts/account.module.js';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

@Module({
  imports: [AccountModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
