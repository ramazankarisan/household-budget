/** Prisma's code for a unique-constraint violation. */
const UNIQUE_CONSTRAINT = 'P2002';

/** True when a write failed on a unique index. Matched structurally, as Prisma's errors are. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === UNIQUE_CONSTRAINT;
}

/**
 * For interactive transactions whose size grows with the user's history: a rule apply over
 * every row, or a multi-year first import. Prisma's default budget is 5 s, which a long
 * history on a slow disk exceeds — it then fails with P2028 and writes nothing. The JS cost
 * is small (27 ms for 50 000 rows × 20 rules); the SQLite round trips were never measured,
 * so the limit is generous rather than tight.
 */
export const LONG_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 };
