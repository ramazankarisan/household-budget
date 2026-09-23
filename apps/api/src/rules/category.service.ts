import { CategoryPayload } from '@household-budget/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

/** Prisma's code for a unique-constraint violation. `Category.name` is the only one here. */
const UNIQUE_CONSTRAINT = 'P2002';

/**
 * The categories a rule or a hand can assign.
 *
 * Deliberately thin: a category is a name and an id. What makes it interesting is what
 * points at it, which is why deletion is the one operation here with an opinion.
 */
@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CategoryPayload[]> {
    const categories = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return categories.map((category) => ({ id: category.id, name: category.name }));
  }

  async create(name: unknown): Promise<CategoryPayload> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed === '') {
      throw new BadRequestException('name is required');
    }

    try {
      const created = await this.prisma.category.create({ data: { name: trimmed } });
      return { id: created.id, name: created.name };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT) {
        throw new ConflictException(`A category named ${trimmed} already exists`);
      }
      throw error;
    }
  }

  async rename(categoryId: string, name: unknown): Promise<CategoryPayload> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed === '') {
      throw new BadRequestException('name is required');
    }
    await this.requireCategory(categoryId);

    try {
      const renamed = await this.prisma.category.update({
        where: { id: categoryId },
        data: { name: trimmed },
      });
      return { id: renamed.id, name: renamed.name };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT) {
        throw new ConflictException(`A category named ${trimmed} already exists`);
      }
      throw error;
    }
  }

  /**
   * Refused while anything points at it, with the counts that explain why.
   *
   * Not a cascade and not a nulling-out: a category in use is a category the user has
   * spent time on, and silently detaching 47 transactions from it is the kind of thing
   * only noticed a month later in a report.
   */
  async remove(categoryId: string): Promise<void> {
    await this.requireCategory(categoryId);

    /*
     * Live rows only. A soft-deleted row is invisible everywhere in the UI, so counting it
     * refuses the deletion with a number the user cannot act on — there is nothing on
     * screen to re-categorize. The relation is optional, so the delete sets `categoryId`
     * to null on those rows rather than failing on the foreign key, and the next apply
     * re-derives whatever a rule still says about them.
     */
    const [rules, transactions, budgets] = await Promise.all([
      this.prisma.rule.count({ where: { categoryId } }),
      this.prisma.transaction.count({ where: { categoryId, deletedAt: null } }),
      // A limit is a decision the user made about this category, in a month they typed
      // it into. The relation is required, so this delete would fail on the foreign key
      // anyway — counting it turns that into a sentence naming how many months.
      this.prisma.budget.count({ where: { categoryId } }),
    ]);

    if (rules > 0 || transactions > 0 || budgets > 0) {
      this.logger.log(
        `delete refused ${categoryId} rules=${String(rules)} transactions=${String(transactions)} budgets=${String(budgets)}`,
      );
      throw new ConflictException({ code: 'CATEGORY_IN_USE', rules, transactions, budgets });
    }

    await this.prisma.category.delete({ where: { id: categoryId } });
  }

  /** Throws rather than returning null: every caller here needs the category to exist. */
  async requireCategory(categoryId: string): Promise<{ id: string; name: string }> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (category === null) {
      throw new NotFoundException(`No category ${categoryId}`);
    }
    return { id: category.id, name: category.name };
  }
}
