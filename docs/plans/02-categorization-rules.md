---
date: 2026-09-23T08:12:21Z
git_commit: e45bcda60d01559a6bbe2baffb532462a7208cc9
branch: feat/csv-import
topic: 'Categorization rules: matching, priority, manual override, CRUD and re-apply'
tags: [plan, categorization, rules, packages-core, apps-api, apps-web, prisma]
status: draft
---

# PLAN: Categorization rules

Deliver the second third of the product: a transaction acquires a category, either because a
rule said so or because the user said so — and the user always wins. This is what turns a list
of bank rows into something a monthly report can group by, which is the third step.

Research: [`docs/research/02-categorization-rules.md`](../research/02-categorization-rules.md).
Its findings were measured against this checkout rather than taken from documentation. Do not
re-derive them — in particular §3, which is the reason matching is not a `WHERE` clause.

## Acceptance Criteria

- [x] A rule `Empfänger enthält "müller"` categorizes the fixture's `Müller GmbH` row. This is the
      case SQLite cannot do: `LIKE '%müller%'` does not match `MÜLLER GmbH` on this build.
- [x] The same rule matches that payee written three ways: `MÜLLER GmbH`, `Müller GmbH`,
      and the NFD form in which the umlaut is a plain `u` followed by the combining
      diaeresis U+0308. The three are different byte sequences and must not look different
      to a rule.
- [x] A rule `Zweck enthält "Miete Oktober Hauptstraße"` matches the fixture row whose stored
      purpose is `'Miete Oktober\r\nHauptstraße 12'`.
- [x] A rule on `Empfänger` neither matches nor throws on the rent row, whose payee is absent.
- [x] An IBAN rule matches whether the user typed `DE89370400440532013000` or
      `DE89 3704 0044 0532 0130 00`.
- [x] Two rules matching one row: the lower `priority` wins. Two rules with the **same** priority
      resolve identically on every run and in a core unit test with no database.
- [x] A category set by hand survives `POST /api/rules/apply`, even when a rule would have
      assigned a different one.
- [x] Clearing the override makes the row eligible again, and the next apply categorizes it.
- [x] Deleting a rule and re-applying **clears** the category that rule had assigned, rather than
      leaving it orphaned.
- [x] `DELETE /api/categories/:id` for a category in use returns 409 naming how many rules and
      transactions use it, and deletes nothing.
- [x] Importing `sparkasse-camt-18.csv` with rules present categorizes the new rows in the same
      transaction, and `ImportSummary.categorized` reports the count.
- [x] Re-importing after a manual override does not clobber the override.
- [x] `POST /api/rules/apply` twice in a row produces identical state; the second call reports
      `assigned: 0, cleared: 0`.
- [x] Every string the rules UI shows exists in both `de` and `en`, asserted the way
      `i18n/importErrors.test.ts` already asserts it.
- [x] `pnpm check` is green at the end of every phase; `pnpm check:all` is green at the end.

## Technical Key Decisions and Tradeoffs

1. **Matching runs in JavaScript, in `packages/core`, over rows already loaded.**
   - Why: measured — SQLite's `LIKE`, `lower()` and `NOCASE` fold ASCII only, so `%müller%` misses
     `MÜLLER GmbH`, and the generated Prisma `StringFilter` has no `mode` field to escape with
     (`commonInputTypes.ts:17-29`). German payee names are the whole point of this feature.
   - Impact: re-apply loads rows into memory. Measured cost at 50 000 rows × 20 rules: 21 ms to
     normalize, 6 ms to match. The round trip dominates, not the matching.
2. **One condition per rule: `field`, `operator`, `value`, `priority`, `categoryId`, `active`.**
   - Why: it is what the brief describes, it needs no join table, and the UI is one row per rule.
     Combining conditions is done by writing two rules.
   - Impact: "payee contains X **and** amount is negative" is not expressible. Adding a
     `RuleCondition` table later is additive and does not invalidate stored rules.
3. **First match wins on `(priority ASC, createdAt ASC, id ASC)`, ordered in core.**
   - Why: one rule decides, so the UI can say _which_. The tiebreak is explicit because two rules
     can carry the same integer priority and a re-apply must be reproducible.
   - Impact: this is the **less common** design — research §9 found that Firefly III and Actual
     Budget both run every matching rule and let the last write win. Firefly III reaches
     first-match-wins only via an opt-in `stop_processing` flag. Ordering lives in core so the
     browser preview and the server agree, and so a unit test can assert it without Prisma.
4. **The normalizer is lifted out of `fingerprint.ts` and shared.**
   - Why: `normalize()` (NFKC → collapse whitespace → trim → lowercase) already solves all three
     German problems — composed vs decomposed umlauts, the CRLF inside `Verwendungszweck`, and
     case. It is module-private today.
   - Impact: `rules/normalize.ts` becomes the one definition of "the same text", imported by both
     `fingerprint.ts` and the matcher. Fingerprint behaviour must not change — its existing tests
     are the regression net.
5. **Manual override is `Transaction.categoryLockedAt DateTime?`.**
   - Why: mirrors the `deletedAt` idiom the schema already uses, and a timestamp answers _when_
     for free. Research §9 found exactly one real precedent for this in the surveyed apps
     (Maybe Finance's attribute-lock map); the three apps without one all mishandle the case.
   - Impact: re-apply filters `categoryLockedAt: null`. That filter is the single line most likely
     to be forgotten and least likely to be noticed, so it gets a test named after the behaviour.
6. **Re-apply also writes `null`, not only matches.**
   - Why: if it only ever wrote matches, a category assigned by a since-deleted rule would survive
     forever. This is also why "the user set it" cannot be inferred from `categoryId != null`.
   - Impact: the apply summary reports `cleared` separately from `assigned`.
7. **Re-apply covers every account, and every row including soft-deleted ones.**
   - Why: rules are global, so applying them is a global act — a per-account button leaves other
     accounts silently stale with no way to tell. Soft-deleted rows are included because a
     re-import restores them in place, and a restored row that skipped every apply would come back
     uncategorized.
   - Impact: `POST /api/rules/apply` takes no body. `evaluated` therefore counts rows the user
     cannot currently see; the UI reports `assigned`/`cleared`, which it can.
8. **Grouped `updateMany`, no chunking.**
   - Why: `updateMany` sets one value across every matched row, so a re-apply groups row ids by
     resulting category and issues one statement per category plus one for the cleared rows —
     `O(categories)`, not `O(rows)`. Verified on this checkout that Prisma 7 with the
     better-sqlite3 adapter handles an `id: { in: [...] }` of **40 000** ids and returns
     `count: 40000`, despite SQLite's measured ceiling of 32 766 bound parameters. Prisma chunks
     internally.
   - Impact: no manual batching. The whole apply runs inside one `$transaction`, as the import
     already does (`import.service.ts:143-199`).
9. **Import categorizes the rows it inserts, inside its existing transaction.**
   - Why: otherwise every import is followed by a manual second step, forever.
   - Impact: `ImportModule` gains a dependency on the rules service, and `ImportSummary` gains
     `categorized`. Restored rows are categorized too; already-stored rows are not touched, which
     keeps an import from silently undoing an override.
10. **Rule input is parsed by `parseRuleInput()` in `packages/core`.**
    - Why: there is no `ValidationPipe` and no `class-validator` in this repo, and the web form
      needs the same checks. A pure parser returning machine codes is testable without Nest,
      reusable verbatim by the browser, and feeds the `ApiError` → `src/i18n` pipeline that
      already exists (`client.ts:73-84`).
    - Impact: the controller becomes a thin caller, as `account.controller.ts` is. This is new
      machinery — it is the one place this plan adds a pattern rather than following one.
11. **Rules UI text lives in `src/i18n`, following the existing shape exactly.**
    - Why: this feature roughly doubles the app's user-facing text, and `importErrors.ts` already
      defines `type Locale = 'de' | 'en'` with a `locale: Locale = 'de'` default parameter and no
      locale state at all.
    - Impact: `src/i18n/rules.ts` exports `rulesText(locale = 'de')`. **No locale switcher, no
      context, no hook** — the same "German by default, English available and tested" posture the
      error messages already have. The three existing pages keep their inline strings.
    - Superseded by [plan 07](07-language-and-theme-switch.md): UI text now lives in src/locales
      via i18next, with a switch.
12. **Out of scope, deliberately.** User-authored regex (research §10 measured `/^(a+)+$/` at
    1 261 ms on 28 characters, and substring covers every fixture); amount and date conditions;
    seeding rules from `bankCategory`; multi-condition rules; reporting.

## Current State

Import works end to end. Nothing categorizes anything, and there is no category to assign.

```
packages/core/src/             apps/api/src/                    apps/web/src/
  api.ts      3 payload types    accounts/  Account+Transaction   App.tsx   1 route, no nav
  index.ts    browser-safe       import/    parse → dedup → store api/client.ts  4 functions
  csv/                           prisma/    @Global() service     pages/    AccountPage
    fingerprint.ts               prisma/schema.prisma                       ImportPanel
      normalize()  ← private       Account, ImportBatch,                    TransactionList
    transaction.ts                 Transaction                    i18n/importErrors.ts
    parse.ts  ← /csv subpath       no Category, no Rule             Locale = 'de' | 'en'
```

What the plan must not trip over:

- `pnpm lint:deps` fails if `packages/core/src` imports `@nestjs`, `@prisma` or `react` — type-only
  included, because `tsPreCompilationDeps: true` (`.dependency-cruiser.cjs:49`).
- `packages/core/tsconfig.json` sets `"types": []`. No `node:crypto`, no `TextDecoder`, no `Date`
  ambient assumptions in the matcher.
- The matcher goes in core's **root** entry, not the `/csv` subpath — `apps/web` bundles the root
  entry and must be able to import `categorize()`.
- `TransactionPayload` is the only shape `apps/web` sees, and it currently carries **no**
  `counterpartyIban`. An IBAN rule is unexplainable and unpreviewable until it does.
- `apps/web` has one route and **no navigation component of any kind**. Phase 5 adds the first.
- `scripts/check-staged-data.mjs` and `.gitignore` block real bank data. No new fixtures are
  needed anyway — `sparkasse-camt-18.csv` already contains `Müller GmbH`, `Ärzte GmbH`,
  `REWE SAGT DANKE; FILIALE 42`, a `Glaeubiger ID`, a row with an absent payee, and a purpose
  containing a CRLF.
- `apps/api` tests run against `data/test.db`, recreated by `src/test/global-setup.ts`; Playwright
  runs against `data/e2e.db`, recreated by `scripts/reset-e2e-db.mjs`. Both are `db push`, so a
  schema change needs no migration file.

## Desired End State

```
 browser                        apps/api                       packages/core
 ───────                        ────────                       ─────────────
 /rules                                                        (browser-safe, pure)
  edit rule ──PATCH /api/rules/:id──► rule.controller ────────► parseRuleInput(body)
                                            │  ok │ errors[]   ◄──┘  codes, not sentences
                                            ▼
  [Regeln anwenden] ─POST /api/rules/apply─► rule.service.applyAll()
                                            │
                                            │ rules  ──────────► orderRules(rules)
                                            │ rows   ──────────► categorize(ordered, row)
                                            │  (categoryLockedAt: null)   │ first match wins
                                            │                             ▼
                                            │        group row ids by resulting categoryId
                                            │                             │
                                            │   one updateMany per category + one → null
                                            │   all inside $transaction
                                            ▼
  summary ◄──JSON── { evaluated, assigned, cleared, locked }

 /  (Umsätze)
  set category ──PATCH /api/transactions/:id──► categoryId + categoryLockedAt = now()
  clear        ──PATCH { categoryId: null }───► categoryId = null, categoryLockedAt = null

 import ──POST /api/imports──► import.service ──► same categorize(), same $transaction
                               ImportSummary.categorized
```

New files:

- `packages/core/src/rules/` — `normalize.ts`, `rule.ts`, `match.ts`, and their tests
- `apps/api/src/rules/` — `rule.{controller,service}.ts`, `category.{controller,service}.ts`,
  `rules.module.ts`, `rule.service.test.ts`, `category.service.test.ts`
- `apps/web/src/pages/RulesPage.tsx`, `CategoryCell.tsx`, `Nav.tsx` and their tests
- `apps/web/src/i18n/rules.ts` and `rules.test.ts`
- `apps/web/e2e/rules.spec.ts`

Changed files: `packages/core/src/{index,api}.ts`, `packages/core/src/csv/fingerprint.ts`,
`apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`,
`apps/api/src/accounts/account.{controller,service}.ts`,
`apps/api/src/import/{import.service,import.module}.ts`, `apps/web/src/App.tsx`,
`apps/web/src/api/client.ts`, `apps/web/src/pages/TransactionList.tsx`.

### UI

Today the app is one page with no navigation:

```
┌──────────────────────────────────────────────────────────┐
│  Household Budget                    [Konto: Giro ▾]     │
│  ┌ CSV importieren ─────────────────────────────────┐    │
│  │  Sparkasse-Export hierher ziehen oder klicken    │    │
│  └──────────────────────────────────────────────────┘    │
│  Datum       Empfänger        Zweck            Betrag    │
│  22.09.2025  Müller GmbH      Rechnung 4711   -832,90 €  │
└──────────────────────────────────────────────────────────┘
```

After, with a category column and the app's first nav:

```
┌──────────────────────────────────────────────────────────┐
│  Household Budget          Umsätze · Regeln  [Giro ▾]    │
│  ┌ CSV importieren ─────────────────────────────────┐    │
│  │  ✓ 8 importiert · 7 kategorisiert                │    │
│  └──────────────────────────────────────────────────┘    │
│  Datum       Empfänger      Zweck      Kategorie  Betrag │
│  22.09.2025  Müller GmbH    Rechn…   [Wohnen  ▾] -832,90 │
│  21.09.2025  REWE SAGT…     Einkauf  [Lebensm ▾]  -42,17 │
│  20.09.2025  —              Miete    [Wohnen 🔒]  -950,00 │
└──────────────────────────────────────────────────────────┘
        🔒 = set by hand; rules will not touch it
```

`/rules`, where categories are managed inline rather than on a page of their own:

```
┌──────────────────────────────────────────────────────────┐
│  Household Budget          Umsätze · Regeln              │
│                                                          │
│  ┌ Kategorien ────────────────────────────────────────┐  │
│  │ Lebensmittel  Wohnen  Gesundheit  Einkommen  [+]   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌ Regeln ───────────────── [Regeln anwenden] ────────┐  │
│  │ Prio Feld       Operator  Suchbegriff   Kategorie  │  │
│  │  10  Empfänger  enthält   REWE          Lebensm. ⋮ │  │
│  │  20  Zweck      enthält   Miete         Wohnen   ⋮ │  │
│  │  30  IBAN       ist       DE98…9999     Gesundh. ⋮ │  │
│  │ [+ Regel anlegen]                                  │  │
│  └────────────────────────────────────────────────────┘  │
│  ✓ 412 geprüft · 318 zugeordnet · 4 gelöscht · 11 manuell│
└──────────────────────────────────────────────────────────┘
```

Deleting a category that is in use is refused, with the counts that explain why:

```
  ⚠ "Wohnen" wird noch verwendet: 2 Regeln, 47 Umsätze.
```

## Abstractions and Code Reuse

- **`normalize()` in `fingerprint.ts:16-22`** is the matcher's normalizer, moved rather than
  reimplemented. Fingerprinting and matching must agree on what "the same text" means.
- **`fingerprintInput` / `dedupKeyHash`** is the precedent for the whole split: core canonicalizes,
  `apps/api` does the part that needs Node. `categorize()` decides, `apps/api` writes.
- **`assignOccurrences`'s determinism** (`fingerprint.ts:56-58`) is the standard `orderRules` is
  held to: same input, same order, no database.
- **`PrismaService` is `@Global()`** (`prisma.module.ts:5`), so new services inject it directly —
  but `RulesModule` still needs registering in `app.module.ts`.
- **`AccountService.requireAccount`** (`account.service.ts:64-70`) is the throw-don't-return
  precedent for `requireRule` and `requireCategory`.
- **The `P2002` → `ConflictException` mapping** (`account.service.ts:47-49`) is the precedent for
  the category-in-use conflict, and for a duplicate category name.
- **`import.service.ts:143-199`** is the `$transaction` + grouped `updateMany` shape `applyAll`
  copies.
- **`ImportPanel`'s discriminated-union state** (`ImportPanel.tsx:19-23`) is the shape the apply
  button uses: `idle | applying | done | error`.
- **`AccountPage`'s `AbortController` + `useRef` guard** (`AccountPage.tsx:51-74`) is what keeps a
  slow rules reload from landing after a newer one.
- **`describeRowError`'s `Record<Locale, …>` + default parameter** (`importErrors.ts:14-43`) is the
  shape `rulesText` follows, including the test that asserts no key renders `undefined` in either
  locale (`importErrors.test.ts:40-41`).

## Logging & Observability

An apply rewrites categories across the whole database, so the one thing worth logging is what it
changed.

```
[RuleService] apply rules=7 evaluated=412 assigned=318 cleared=4 locked=11
[RuleService] apply rule=clx8… field=counterpartyName matched=214
[ImportService] import 7f3a… categorized=197
[CategoryService] delete refused clx2… rules=2 transactions=47
```

**Never log a rule's `value` at info level.** A keyword is a fragment of a payee name, which is
the user's spending history — the same reason `import.service.ts` logs a masked IBAN and never a
`Verwendungszweck`. Log the rule id and the field it matches on; that is enough to find it.

## Implementation

### Phase 1: The matcher in `packages/core`

Dependencies: None. Pure, no database, no schema.

The whole decision layer, written and tested before anything can store it. Nothing outside core
changes in this phase, so `pnpm check` stays green throughout.

**Tasks**:

- [x] Add `packages/core/src/rules/normalize.ts`. Move `normalize` and `normalizeIban` verbatim out
      of `csv/fingerprint.ts`, export them, and have `fingerprint.ts` import them. **Behaviour must
      not change** — `fingerprint.test.ts` is the regression net and must pass untouched.
- [x] Add `packages/core/src/rules/rule.ts`:

```ts
export type RuleField = 'counterpartyName' | 'purpose' | 'counterpartyIban';
export type RuleOperator = 'contains' | 'startsWith' | 'endsWith' | 'equals';
export type RuleInputErrorCode =
  | 'FIELD_UNKNOWN'
  | 'OPERATOR_UNKNOWN'
  | 'OPERATOR_NOT_ALLOWED_FOR_FIELD'
  | 'VALUE_EMPTY'
  | 'VALUE_TOO_LONG'
  | 'PRIORITY_NOT_AN_INTEGER'
  | 'CATEGORY_REQUIRED';
export interface RuleInputError {
  readonly code: RuleInputErrorCode;
  readonly field: string; // the form field, so the UI can mark it
}
export interface Rule {
  readonly id: string;
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly priority: number;
  readonly categoryId: string;
  readonly active: boolean;
  readonly createdAt: string; // ISO, for the tiebreak
}

/**
 * What a create or update supplies: a `Rule` without the fields the database owns.
 * `active` is here because the form can toggle it; `id` and `createdAt` never are.
 */
export type RuleInput = Omit<Rule, 'id' | 'createdAt'>;
```

- [x] `parseRuleInput(body: unknown): { ok: true; rule: RuleInput } | { ok: false; errors: RuleInputError[] }`.
      Returns **all** errors, not the first, so the form can mark every bad field at once.
      `counterpartyIban` accepts only `equals`, and its value is normalized with `normalizeIban`
      at parse time so grouping spaces never reach the database. Cap `value` at 200 characters.
- [x] Add `packages/core/src/rules/match.ts`:
  - `matchRule(rule, transaction): boolean` — reads the named field, normalizes both sides,
    applies the operator. A `null`/`undefined` field value is the empty string, which matches
    nothing except an `equals ''` rule.
  - `orderRules(rules): readonly Rule[]` — `priority ASC`, then `createdAt ASC`, then `id ASC`.
    Filters out `active: false`.
  - `categorize(ordered, transaction): string | undefined` — first match wins.
- [x] Extend `packages/core/src/index.ts` additively with the rules surface **and** `normalize`.
      Do not touch the `/csv` subpath — the matcher must be importable by `apps/web`.
- [x] Write `rules/match.test.ts` and `rules/rule.test.ts` using the fixture's own strings as
      literals: `'Müller GmbH'`, `'MÜLLER GmbH'`, `'Ärzte GmbH'`,
      `'REWE SAGT DANKE; FILIALE 42'`, `'Miete Oktober\r\nHauptstraße 12'`, and an absent payee.

**Automated Verification**:

- [x] `matchRule` with `{ field: 'counterpartyName', operator: 'contains', value: 'müller' }`
      matches `'Müller GmbH'` **and** `'MÜLLER GmbH'` **and** `'Müller GmbH'`.
- [x] A `purpose contains 'Miete Oktober Hauptstraße'` rule matches
      `'Miete Oktober\r\nHauptstraße 12'` — the CRLF collapse.
- [x] A `counterpartyName` rule against `counterpartyName: null` returns `false` and does not throw.
- [x] `counterpartyIban equals 'DE89 3704 0044 0532 0130 00'` matches a stored
      `'DE89370400440532013000'`.
- [x] `parseRuleInput` rejects an empty value, a 201-character value, a non-integer priority, an
      unknown field, and `{ field: 'counterpartyIban', operator: 'contains' }`; a body with three
      problems returns three errors.
- [x] `orderRules` on rules with equal `priority` returns the same order across 100 shuffles of the
      input.
- [x] `categorize` returns the lower-priority rule's category when two rules match.
- [x] `fingerprint.test.ts` passes unchanged after the normalizer move.
- [x] `pnpm --filter @household-budget/core test` and `pnpm lint:deps` pass.
- [x] `pnpm check` green.

### Phase 2: Schema and the shared contract

Dependencies: Phase 1.

The models and the payload types. This is the phase that deliberately breaks `pnpm typecheck` in
both apps until their mappers are updated — the same way Phase 4 of the import plan did.

**Tasks**:

- [x] Add to `apps/api/prisma/schema.prisma`:

```prisma
model Category {
  id           String        @id @default(cuid())
  name         String        @unique
  createdAt    DateTime      @default(now())
  rules        Rule[]
  transactions Transaction[]
}

model Rule {
  id         String   @id @default(cuid())
  /// 'counterpartyName' | 'purpose' | 'counterpartyIban'
  field      String
  /// 'contains' | 'startsWith' | 'endsWith' | 'equals'
  operator   String
  value      String
  /// Lower runs first. Ties break on createdAt then id, so an apply is reproducible.
  priority   Int      @default(100)
  categoryId String
  category   Category @relation(fields: [categoryId], references: [id])
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@index([active, priority, createdAt])
}
```

- [x] Add to `model Transaction`:

```prisma
  categoryId String?
  category   Category? @relation(fields: [categoryId], references: [id])
  /// Set by a human. Non-null means the rules engine must not touch categoryId.
  /// Mirrors deletedAt: the column's presence is the decision, the timestamp is the audit.
  categoryLockedAt DateTime?

  @@index([categoryId])
```

- [x] `pnpm --filter @household-budget/api db:push`, then `pnpm --filter @household-budget/api prisma:generate`.
      The three blocks above were checked while writing this plan: `prisma validate` accepts them
      and `db push` applies them to a throwaway SQLite file cleanly, so the relation pairings and
      the `@@index` syntax are known-good rather than assumed. Note that `db push` in Prisma 7
      **runs the generator** — there is no `--skip-generate` on that subcommand here — which is
      why the check was done with the generator output redirected. Pushing the real schema
      regenerates `src/generated/prisma`, which is what you want in this step.
- [x] Extend `packages/core/src/api.ts`:
  - `CategoryPayload { id, name }`
  - `RulePayload { id, field, operator, value, priority, categoryId, active }`
  - `ApplySummary { evaluated, assigned, cleared, locked }`
  - `TransactionPayload` gains `categoryId: string | null`, `categoryLockedAt: string | null` and
    `counterpartyIban: string | null`. The IBAN is what makes an IBAN rule explainable on screen.
  - `ImportSummary` gains `categorized: number`.
- [x] Update `AccountService.listTransactions`'s mapper for the three new fields.
- [x] Update `ImportService` to return `categorized: 0` — the real number arrives in Phase 4.
- [x] Update `TransactionList.test.tsx`'s `transaction()` builder and
      `AccountPage.test.tsx`'s `row()` helper for the new required fields.

**Automated Verification**:

- [x] `pnpm typecheck` passes across all three packages.
- [x] `pnpm --filter @household-budget/api test` passes — import behaviour is unchanged.
- [x] `pnpm --filter @household-budget/web test` passes.
- [x] A row inserted with no category reads back `categoryId: null, categoryLockedAt: null`.
- [x] `pnpm check` green.

### Phase 3: Categories and rules CRUD

Dependencies: Phase 2.

The API surface, with no applying yet. Everything here is testable against the real test database
in the style of `import.service.test.ts`.

**Tasks**:

- [x] Add `apps/api/src/rules/category.service.ts`: `list`, `create`, `rename`, `remove`.
  - `create` trims the name, rejects empty, and maps `P2002` to a `ConflictException`.
  - `remove` counts dependent rules and transactions first; if either is non-zero it throws
    `new ConflictException({ code: 'CATEGORY_IN_USE', rules, transactions })` and deletes nothing.
- [x] Add `apps/api/src/rules/rule.service.ts`: `list`, `create`, `update`, `remove`,
      `requireRule`. `create` and `update` call `parseRuleInput` and throw
      `new BadRequestException({ code: 'RULE_INVALID', errors })` when it fails. Both verify the
      target category exists.
  - `list` returns rules already ordered by `orderRules`, so the UI and the engine agree.
- [x] Add the controllers — `@Controller('categories')` and `@Controller('rules')` — following
      `account.controller.ts`: thin, `@HttpCode(204)` on delete, no pipes.
- [x] Add `rules.module.ts`, export `RuleService` (Phase 4's import wiring needs it), and register
      it in `app.module.ts`.
- [x] Write `category.service.test.ts` and `rule.service.test.ts`. Their `beforeEach` truncation
      extends the existing one (`import.service.test.ts:34-36`) and **the order now matters**:
      `transaction` → `importBatch` → `account` → `rule` → `category`. Both `Transaction` and
      `Rule` hold a foreign key into `Category`, so deleting categories first fails the
      constraint. `import.service.test.ts` needs the same two lines added, or a later phase's
      categorized rows will leak into its counts.

**Automated Verification**:

- [x] `POST /api/categories` twice with the same name returns 409.
- [x] `DELETE /api/categories/:id` on an unused category returns 204 and removes it.
- [x] `DELETE /api/categories/:id` on one used by 1 rule and 2 transactions returns 409 with
      `{ code: 'CATEGORY_IN_USE', rules: 1, transactions: 2 }`, and the category still exists.
- [x] `POST /api/rules` with an empty value returns 400 with `code: 'RULE_INVALID'` and a
      `VALUE_EMPTY` entry.
- [x] `POST /api/rules` with a non-existent `categoryId` returns 404.
- [x] `GET /api/rules` returns rules in `orderRules` order, asserted against a set inserted out of
      order and including a priority tie.
- [x] `pnpm check` green.

### Phase 4: Applying — re-apply, manual override, and import

Dependencies: Phase 3. This is the phase that makes the feature real.

**Tasks**:

- [x] Add `RuleService.applyAll(tx?): Promise<ApplySummary>`:
  1. Load active rules, `orderRules` them. ~~No rules ⇒ return zeros without writing.~~
     **Changed during implementation:** that guard contradicts this phase's own
     verification ("Delete the rule, apply: the row's `categoryId` is `null` and `cleared`
     is 1") and the acceptance criterion behind it, since the deleted rule is usually the
     only one. An unlocked category exists because a rule put it there, so with no active
     rules left the honest result is that nothing is categorized. Hand-set rows are locked
     and are never loaded, so no user decision is reachable from here.
  2. Load every transaction with `categoryLockedAt: null`, selecting only the id and the three
     matchable fields. Soft-deleted rows included, per decision 7.
  3. `categorize` each in memory. Build two collections, both excluding rows that already hold
     the value they would be given — that exclusion is what makes a repeat apply write nothing:
     - `assign`: a map of category id → row ids, for rows whose match differs from their current
       `categoryId`.
     - `clear`: row ids whose current `categoryId` is non-null but which now match no rule.
  4. One `updateMany` per entry in `assign`, plus one setting `categoryId: null` for `clear`.
  5. Counts, stated exactly because two of them are easy to get subtly wrong:
     - `evaluated` — rows loaded in step 2, i.e. every unlocked row, matched or not.
     - `assigned` — total row ids across `assign`, so a row already holding its match is **not**
       counted. This is what makes the second of two identical applies report `0`.
     - `cleared` — size of `clear`.
     - `locked` — one `count` on `categoryLockedAt: { not: null }`. A plain standing total of
       hand-set rows, **not** "rows a rule would have changed": those rows are never loaded or
       categorized, so the engine cannot know whether a rule would have hit them, and pretending
       otherwise would mean loading and matching them for a number nobody acts on. The UI labels
       it `manuell` rather than "skipped" for the same reason.
  - Accepts an optional transaction client so Phase 4's import wiring can reuse it inside the
    import's own `$transaction`; when absent it opens its own.
- [x] Add `POST /api/rules/apply` returning `ApplySummary`. No body.
- [x] Add `PATCH /api/transactions/:id` to the existing `TransactionController`:
  - `{ categoryId: string }` sets the category and `categoryLockedAt: new Date()`.
  - `{ categoryId: null }` clears both, making the row eligible again.
  - 404 on an unknown transaction or category.
- [x] Wire into `ImportService.importCsv`, **inside** the existing `$transaction`, after the
      inserts and restores: categorize the inserted and restored rows only, using the same grouped
      `updateMany`. Report the count as `ImportSummary.categorized`.
- [x] Extend `import.service.test.ts` rather than replacing it — the existing dedup, pending and
      restore assertions must keep passing.

**Automated Verification**:

- [x] A rule on `müller` + apply gives the `Müller GmbH` row that category. The SQL-can't-do-this
      case, end to end.
- [x] Hand-set a category, then apply a rule that would assign a different one: the row keeps the
      hand-set category and `locked` is 1. `locked` is a whole-database total, so this assertion
      only holds under per-test isolation — the suite already truncates every table in `beforeEach`
      (`import.service.test.ts:34-36`), and this test must follow that pattern rather than
      appending to whatever a previous test left behind.
- [x] `PATCH { categoryId: null }` then apply: the row is now categorized by the rule.
- [x] Delete the rule, apply: the row's `categoryId` is `null` and `cleared` is 1.
- [x] Apply twice: the second returns `assigned: 0, cleared: 0` and the database is byte-identical.
- [x] Import with rules present: `summary.categorized` is non-zero and the rows come back
      categorized in one request.
- [x] Import, hand-override a row, re-import the same file: the override survives, and `imported`
      is still 0.
- [x] Soft-delete a categorized row, apply, re-import to restore it: it comes back with its
      category.
- [x] `pnpm check` green.

### Phase 5: The web UI

Dependencies: Phase 4.

**Tasks**:

- [x] Add `apps/web/src/i18n/rules.ts` — `rulesText(locale: Locale = 'de')` returning a typed
      object of every label, and `describeRuleError(errors, locale = 'de')` mapping
      `RuleInputErrorCode` to a sentence, following `describeRowError`'s shape exactly. Both
      locales complete. Reuse the exported `Locale` from `importErrors.ts` rather than redeclaring.
- [x] Add the client functions to `api/client.ts`: `listCategories`, `createCategory`,
      `deleteCategory`, `listRules`, `createRule`, `updateRule`, `deleteRule`, `applyRules`,
      `setTransactionCategory`. Same relative-`/api` and `AbortSignal` conventions.
- [x] Add `Nav.tsx` — the app's first navigation, two links, `NavLink` from react-router.
- [x] Add the `/rules` route to `App.tsx`.
- [x] Add `RulesPage.tsx`: the category strip with inline create and delete, the rules table, a
      create/edit form, and the apply button with an `idle | applying | done | error` state. The
      form marks each field named in a returned `RuleInputError`, and calls `parseRuleInput` from
      core **before** submitting so the common case never round-trips.
- [x] Add `CategoryCell.tsx` and use it in `TransactionList.tsx` — a select showing the current
      category, a lock affordance when `categoryLockedAt` is set, and a "clear" option that unlocks.
      `TransactionList` becomes a component that takes `categories` and an `onCategoryChange`
      callback; `AccountPage` owns the refresh.
- [x] Write `RulesPage.test.tsx`, `CategoryCell.test.tsx` and `i18n/rules.test.ts` in the existing
      style — `vi.mock('../api/client', …)`, a `rule()` builder mirroring `transaction()`.
- [x] Add `apps/web/e2e/rules.spec.ts` as a `test.describe.serial`: create an account, import
      `sparkasse-camt-18.csv`, create the category `Wohnen`, create the rule
      `Empfänger enthält müller → Wohnen`, apply, and assert the `Müller GmbH` row shows `Wohnen`.
      Then set another row's category by hand, apply again, and assert it is unchanged.
- [x] Update `README.md`'s layout section and `CLAUDE.md`'s status paragraph — import → categorize
      is now two-thirds done — and link this plan and the research from `CLAUDE.md`, per its
      "Link, do not inline" rule.

**Automated Verification**:

- [x] `RulesPage` renders rules in the order the API returned and does not re-sort them.
- [x] Submitting an empty keyword marks the field and issues no request.
- [x] A 409 from `deleteCategory` renders the German sentence with both counts.
- [x] Every key of `rulesText('de')` and `rulesText('en')` is a non-empty string containing no
      `undefined`, asserted the way `importErrors.test.ts:40-41` does.
- [x] `pnpm --filter @household-budget/web test` passes.
- [x] `pnpm test:e2e` passes, `rules.spec.ts` included.
- [x] `pnpm check:all` green.

**Manual Verification**:

- [ ] Create a rule matching a payee that carries an umlaut in your own data, apply it, and confirm
      the row categorizes. This is the one check that proves the measured SQLite finding matters in
      practice rather than only in a fixture.
- [ ] Set a category by hand on a row a rule also matches, press "Regeln anwenden", and confirm the
      hand-set value is still there and still marked.
- [ ] Import a second export and confirm the summary reports a categorized count and the new rows
      arrive already categorized.

## References

- [`docs/research/02-categorization-rules.md`](../research/02-categorization-rules.md) — every
  measured finding this plan depends on, and the prior-art survey behind decisions 3, 5 and 12
- [`docs/plans/01-csv-import.md`](01-csv-import.md) — the schema and conventions this builds on
- `packages/core/src/csv/fingerprint.ts:16-22,56-58` — the normalizer, and the determinism standard
- `packages/core/src/api.ts:17-47` — the payload contract Phase 2 extends
- `apps/api/src/generated/prisma/commonInputTypes.ts:17-29` — `StringFilter` with no `mode`, the
  reason matching is not a `WHERE` clause
- `apps/api/src/import/import.service.ts:143-199` — the `$transaction` + grouped `updateMany` shape
- `apps/api/src/accounts/account.service.ts:47-49,64-70` — `P2002` → 409, and `requireX` → 404
- `apps/api/src/accounts/account.controller.ts:50-59` — the `TransactionController` Phase 4 extends
- `apps/web/src/i18n/importErrors.ts:14-43` — the `Locale` shape `rules.ts` follows
- `apps/web/src/pages/AccountPage.tsx:51-74` — the `AbortController` + `useRef` load guard
- `apps/web/src/pages/ImportPanel.tsx:19-23` — the discriminated-union panel state
- `.dependency-cruiser.cjs:13-31,49` — why the matcher cannot import Prisma, type-only included
- `CLAUDE.md` — RULES: core framework-free, never commit real bank data, `pnpm check` before done
