import { CategoryPayload } from '@household-budget/core';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { CategoryService } from './category.service.js';

interface CategoryBody {
  readonly name?: unknown;
}

/** Thin, like `account.controller.ts`: the service holds every rule about a category. */
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  /** GET /api/categories */
  @Get()
  list(): Promise<CategoryPayload[]> {
    return this.categories.list();
  }

  /** POST /api/categories */
  @Post()
  create(@Body() body: CategoryBody): Promise<CategoryPayload> {
    return this.categories.create(body.name);
  }

  /** PATCH /api/categories/:id */
  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: CategoryBody): Promise<CategoryPayload> {
    return this.categories.rename(id, body.name);
  }

  /** DELETE /api/categories/:id — 409 while any rule or transaction still points at it. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
