import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HelloModule } from './hello/hello.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    // Loads apps/api/.env before any provider is constructed.
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HelloModule,
  ],
})
export class AppModule {}
