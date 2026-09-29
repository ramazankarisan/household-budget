# apps/api

NestJS 12, SQLite via Prisma 7. Global route prefix `api`.
Each point is deliberate; where there is a link, it is the reason. Do not undo one without reading it.

- Local only: binds `127.0.0.1`, sends no CORS headers, answers 403 to a non-loopback `Host`
  or `Origin` (`src/security/loopback.ts`). [plan 06](../../docs/plans/06-security-hardening.md)
- `POST /api/imports` takes a bank CSV scoped to an account (Sparkasse CSV-CAMT or Deutsche
  Bank), decodes it here (UTF-8, falling back to Windows-1252) and hashes it, then parses it
  in core. Rows are deduplicated by content fingerprint plus occurrence index, so an
  overlapping export imports only what is new. Bad rows are reported with their line number
  while the rest imports; an unparseable file is a 4xx. An import categorizes the rows it
  inserts inside its own transaction.
- `POST /api/rules/apply` re-runs the rules over every account and writes `null` as well as
  matches, so a category never outlives the rule that explains it.
- A category set by hand sets `Transaction.categoryLockedAt`; rules never touch that row again
  until it is cleared.
- Budgets are one limit per category per month, household-wide, measured against every account.
- `consistent-type-imports` is off here: Nest reads constructor parameter types at runtime
  (`design:paramtypes`), so `import type` breaks DI.
- `src/generated/` is the Prisma client. Change `prisma/schema.prisma`, then `prisma:generate`
  and `db:push`.
