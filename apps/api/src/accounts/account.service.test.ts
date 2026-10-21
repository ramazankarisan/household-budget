import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryService } from '../rules/category.service.js';
import { AccountService } from './account.service.js';

let prisma: PrismaService;
let accounts: AccountService;

beforeEach(async () => {
  if (prisma === undefined) {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AccountService, CategoryService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    accounts = moduleRef.get(AccountService);
  }
  await prisma.transaction.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.account.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AccountService.create', () => {
  it('stores an IBAN typed in groups as one canonical IBAN', async () => {
    const created = await accounts.create(' de89 3704 0044 0532 0130 00 ', 'Giro');

    expect(created.iban).toBe('DE89370400440532013000');
  });

  it('refuses a mistyped IBAN with a coded 400, and stores nothing', async () => {
    // One wrong digit: the account would exist, and no export of the real one would ever fit.
    await expect(accounts.create('DE89370400440532013001', 'Giro')).rejects.toMatchObject({
      response: { code: 'IBAN_INVALID' },
    });
    expect(await prisma.account.count()).toBe(0);
  });
});
