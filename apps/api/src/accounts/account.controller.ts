import { AccountPayload, TransactionPayload } from '@household-budget/core';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';

import { AccountService } from './account.service.js';

interface CreateAccountBody {
  readonly iban?: unknown;
  readonly name?: unknown;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  return value;
}

@Controller('accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  /** GET /api/accounts */
  @Get()
  list(): Promise<AccountPayload[]> {
    return this.accounts.list();
  }

  /** POST /api/accounts */
  @Post()
  create(@Body() body: CreateAccountBody): Promise<AccountPayload> {
    return this.accounts.create(requireString(body.iban, 'iban'), requireString(body.name, 'name'));
  }

  /** GET /api/accounts/:id/transactions */
  @Get(':id/transactions')
  listTransactions(@Param('id') id: string): Promise<TransactionPayload[]> {
    return this.accounts.listTransactions(id);
  }
}

@Controller('transactions')
export class TransactionController {
  constructor(private readonly accounts: AccountService) {}

  /** DELETE /api/transactions/:id — soft delete; the next import restores it. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.accounts.softDeleteTransaction(id);
  }
}
