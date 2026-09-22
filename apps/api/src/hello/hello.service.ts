import { buildHelloPayload, DbStatus, HelloPayload } from '@household-budget/core';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HelloService {
  private readonly logger = new Logger(HelloService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getHello(): Promise<HelloPayload> {
    return buildHelloPayload({ db: await this.probeDatabase() });
  }

  /**
   * Cheapest possible round-trip to SQLite. A failure degrades the payload
   * rather than failing the request — the endpoint's job is to report wiring
   * status, including when the wiring is broken.
   */
  private async probeDatabase(): Promise<DbStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database probe failed: ${reason}`);
      return 'unavailable';
    }
  }
}
