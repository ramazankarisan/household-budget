import { CATEGORY_COLOR_COUNT, CategoryPayload, normalize } from '@household-budget/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

/** Prisma's code for a unique-constraint violation. `Category.name` is the only one here. */
const UNIQUE_CONSTRAINT = 'P2002';

/** What a rename or a recolour may carry; either field alone is a complete request. */
export interface CategoryUpdate {
  readonly name?: unknown;
  readonly colorIndex?: unknown;
}

function toPayload(category: {
  id: string;
  name: string;
  colorIndex: number | null;
}): CategoryPayload {
  // `null` never reaches the wire: `onModuleInit` fills the old rows in before a request can.
  return { id: category.id, name: category.name, colorIndex: category.colorIndex ?? 0 };
}

function isColorIndex(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < CATEGORY_COLOR_COUNT
  );
}

/**
 * The categories a rule or a hand can assign.
 *
 * Deliberately thin: a category is a name, an id and a colour. What makes it interesting is what
 * points at it, which is why deletion is the one operation here with an opinion.
 */
@Injectable()
export class CategoryService implements OnModuleInit {
  private readonly logger = new Logger(CategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gives every category stored before `colorIndex` existed a colour, in the order they
   * were created, by the same rule `create` uses — so an old database ends up exactly as
   * if its categories had been made today. Idempotent: a second run finds nothing to do.
   */
  async onModuleInit(): Promise<void> {
    const missing = await this.prisma.category.findMany({
      where: { colorIndex: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (missing.length === 0) {
      return;
    }
    let next = await this.nextColorIndex();
    for (const category of missing) {
      await this.prisma.category.update({
        where: { id: category.id },
        data: { colorIndex: next },
      });
      next = (next + 1) % CATEGORY_COLOR_COUNT;
    }
    this.logger.log(`Assigned colours to ${String(missing.length)} categories without one`);
  }

  /**
   * The colour a new category gets: the next one round the palette, counted over the
   * categories that already have one. Deleting one does not reshuffle the others.
   */
  async nextColorIndex(): Promise<number> {
    const coloured = await this.prisma.category.count({ where: { colorIndex: { not: null } } });
    return coloured % CATEGORY_COLOR_COUNT;
  }

  async list(): Promise<CategoryPayload[]> {
    const categories = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return categories.map(toPayload);
  }

  async create(name: unknown): Promise<CategoryPayload> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed === '') {
      throw new BadRequestException('name is required');
    }
    await this.assertNameFree('create', trimmed);

    try {
      const created = await this.prisma.category.create({
        data: { name: trimmed, colorIndex: await this.nextColorIndex() },
      });
      return toPayload(created);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT) {
        throw new ConflictException(`A category named ${trimmed} already exists`);
      }
      throw error;
    }
  }

  /**
   * A rename, a recolour, or both. Each field present is validated; an absent one keeps
   * what is stored.
   */
  async update(categoryId: string, body: CategoryUpdate): Promise<CategoryPayload> {
    const data: { name?: string; colorIndex?: number } = {};

    if (body.name !== undefined) {
      const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
      if (trimmed === '') {
        throw new BadRequestException('name is required');
      }
      data.name = trimmed;
    }
    if (body.colorIndex !== undefined) {
      if (!isColorIndex(body.colorIndex)) {
        throw new BadRequestException({ code: 'CATEGORY_COLOR_INVALID' });
      }
      data.colorIndex = body.colorIndex;
    }
    if (data.name === undefined && data.colorIndex === undefined) {
      throw new BadRequestException('name or colorIndex is required');
    }

    await this.requireCategory(categoryId);
    if (data.name !== undefined) {
      await this.assertNameFree('rename', data.name, categoryId);
    }

    try {
      const updated = await this.prisma.category.update({ where: { id: categoryId }, data });
      return toPayload(updated);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT) {
        throw new ConflictException(`A category named ${data.name ?? ''} already exists`);
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

  /**
   * Refuses a name another category already has under `normalize` — the fold rules and
   * search use — so `Wohnen` and `wohnen` cannot both exist. The `@unique` on `name` is
   * exact-match only (SQLite compares bytes), so without this the case variant went in
   * as a second category and the spending split between the two.
   *
   * In JavaScript over every name rather than in SQL, for the reason in packages/core/CLAUDE.md: SQLite
   * folds ASCII only. Check-then-insert can race; this is a single-user local app, and
   * `@unique` still catches the exact duplicate. `exceptId` lets a rename change only the
   * case of its own name. Duplicates stored before this check are left alone.
   */
  private async assertNameFree(
    operation: 'create' | 'rename',
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const wanted = normalize(name);
    const existing = await this.prisma.category.findMany({ select: { id: true, name: true } });
    const clash = existing.find(
      (category) => category.id !== exceptId && normalize(category.name) === wanted,
    );
    if (clash !== undefined) {
      this.logger.log(
        `${operation} refused name=${JSON.stringify(name)} collides with ${clash.id} ${JSON.stringify(clash.name)}`,
      );
      throw new ConflictException(`A category named ${clash.name} already exists`);
    }
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
