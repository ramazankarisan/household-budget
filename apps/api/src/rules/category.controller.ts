import { CategoryPayload } from '@household-budget/core';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { CategoryService, type CategoryUpdate } from './category.service.js';

interface CategoryBody {
  readonly name?: unknown;
  readonly colorIndex?: unknown;
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

  /** PATCH /api/categories/:id — `{ name?, colorIndex? }`, at least one of them. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: CategoryBody): Promise<CategoryPayload> {
    const update: CategoryUpdate = { name: body.name, colorIndex: body.colorIndex };
    return this.categories.update(id, update);
  }

  /** DELETE /api/categories/:id — 409 while any rule or transaction still points at it. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
