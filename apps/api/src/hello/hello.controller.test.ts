import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { HelloController } from './hello.controller.js';
import { HelloService } from './hello.service.js';

async function createController(queryRaw: () => Promise<unknown>): Promise<HelloController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HelloController],
    providers: [HelloService, { provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
  }).compile();

  return moduleRef.get(HelloController);
}

describe('HelloController', () => {
  it('reports db "ok" when the probe succeeds', async () => {
    const controller = await createController(vi.fn().mockResolvedValue([{ 1: 1 }]));

    const payload = await controller.getHello();

    expect(payload.message).toBe('hello from api');
    expect(payload.db).toBe('ok');
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it('degrades to db "unavailable" instead of throwing when the probe fails', async () => {
    const controller = await createController(
      vi.fn().mockRejectedValue(new Error('no such table')),
    );

    const payload = await controller.getHello();

    expect(payload.db).toBe('unavailable');
    expect(payload.message).toBe('hello from api');
  });
});
