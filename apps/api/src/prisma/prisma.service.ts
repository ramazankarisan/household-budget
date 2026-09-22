import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { resolveDatabaseUrl } from '../config/database.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * better-sqlite3 creates the database file but not the directory holding it,
 * so a fresh clone would fail on first boot. Returns the url unchanged.
 */
function ensureDatabaseDirectory(url: string): string {
  if (url.startsWith('file:')) {
    const filePath = url.slice('file:'.length);
    if (filePath !== ':memory:') {
      mkdirSync(dirname(resolve(filePath)), { recursive: true });
    }
  }
  return url;
}

function databaseUrl(): string {
  return ensureDatabaseDirectory(resolveDatabaseUrl());
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Prisma 7 is driver-adapter based: no Rust query engine at runtime.
    super({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('SQLite connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
