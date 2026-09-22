import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AccountModule } from './accounts/account.module.js';
import { ImportModule } from './import/import.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    // Loads apps/api/.env before any provider is constructed.
    ConfigModule.forRoot({ isGlobal: true }),
    // PrismaModule is @Global(), which covers the provider — not the registration.
    PrismaModule,
    AccountModule,
    ImportModule,
  ],
})
export class AppModule {}
