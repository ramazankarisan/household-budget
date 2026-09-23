---
date: 2026-09-22T22:05:17Z
git_commit: e45bcda60d01559a6bbe2baffb532462a7208cc9
branch: feat/csv-import
topic: 'Categorization rules: matching, priority, manual override, CRUD and re-apply'
tags: [research, categorization, rules, packages-core, apps-api, apps-web, prisma, sqlite]
status: complete
---

# Research: Categorization rules

## Research question

How should a rules engine be built in this repo? Rules match on payee keyword, purpose text or
IBAN, carry a priority, and assign a category. A manual override on a single transaction wins
over any rule. The API needs rules CRUD plus a re-apply endpoint, and `apps/web` needs a rules
management UI.

## Summary

The feature splits along the same seam the CSV import found, and for the same reason:
**matching is pure string work, so it belongs in `packages/core`; ordering, persistence and
the re-apply write belong in `apps/api`.** What is new is that the seam is not optional this
time — it is forced by a measured property of the database.

**SQLite cannot case-fold a German payee name.** Measured on this checkout: `LIKE '%rewe%'`
matches `REWE SAGT DANKE`, but `LIKE '%müller%'` does **not** match `MÜLLER GmbH`, and
`lower('MÜLLER')` returns `'mÜller'`. The generated Prisma client's `StringFilter` has no
`mode` field, so `mode: 'insensitive'` does not exist here either. A rule that matches on a
payee keyword therefore cannot be a `WHERE` clause. It has to run in JavaScript — which is
where the pure, testable, already-written normalizer lives.

Two facts the brief assumes are not in the repo yet:

- **There is no category.** `Transaction.bankCategory` is the bank's own free-text German
  label, explicitly documented as "never trusted as a key". A `Category` model has to be built
  as part of this work.
- **There is no way to edit a transaction.** The only write on a stored row is
  `DELETE /api/transactions/:id` (soft delete), and `apps/web` never calls it. A manual
  override needs a new endpoint and a new client function.

The six substantive decisions:

| Decision            | Choice                                                    | Confidence                               |
| ------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Where matching runs | `packages/core`, in JS, over loaded rows                  | High — SQL case folding measured broken  |
| Normalization       | NFKC + whitespace collapse + `toLowerCase`                | High — the existing `fingerprint.ts` one |
| Operators           | Substring on payee/purpose, exact on IBAN. No user regex  | Medium — regex cost measured, see §10    |
| Priority            | Total order, first match wins, deterministic tiebreak     | Medium — no surveyed engine does it, §9  |
| Override            | A nullable column on `Transaction`, mirroring `deletedAt` | High on shape — one strong precedent, §9 |
| Assignment          | Stored on the row, recomputed by re-apply                 | High — reporting needs `GROUP BY`        |

```
packages/core/src/
  api.ts                 EXTEND — RulePayload, CategoryPayload, ApplySummary;
                         TransactionPayload gains categoryId + counterpartyIban
  index.ts               EXTEND — the rules surface, browser-safe
  csv/fingerprint.ts     normalize() lives here, module-private today
  rules/                 NEW — all pure, all string-in
    normalize.ts           the shared normalizer, lifted out of fingerprint.ts
    rule.ts                Rule, RuleField, RuleOperator, validation
    match.ts               matchRule, categorize(rules, transaction)
apps/api/src/rules/      NEW — persistence, ordering, the re-apply write
  rule.controller.ts       CRUD + POST /api/rules/apply
  rule.service.ts          Prisma + $transaction, grouped updateMany
  category.controller.ts   categories have to exist before rules can assign them
apps/api/prisma/schema.prisma  NEW models Category, Rule; Transaction gains 2 columns
apps/web/src/pages/
  RulesPage.tsx            NEW — the app's second route
apps/web/src/App.tsx     EXTEND — /rules, and the first navigation the app has had
```

```
 CRUD            ┌──────────── apps/api/src/rules ────────────┐
 POST /api/rules │  rule.service: order, persist, write        │
                 └────────────────────┬───────────────────────┘
                                      │ rows + rules, both in memory
 POST /api/rules/apply                ▼
                        packages/core/src/rules/match.ts
                        categorize(rules, tx) → categoryId | undefined
                                      │
                       group row ids by resulting categoryId
                                      ▼
                  one updateMany per category, inside $transaction
                  WHERE manual override IS NULL   ← the one guard that matters

 apps/web imports the same categorize() from core's browser-safe root entry,
 so the rule form previews "matches 23 of 412 rows" with no round trip.
```

## What the codebase forces

Five premises in the brief need adjusting before anything is built. They are listed first
because they change what gets built.

1. **"Assign a category" has no category to assign.** `Transaction.bankCategory`
   (`schema.prisma:78`) is the `Kategorie` column from the export — German, bank-assigned,
   free text. `packages/core/src/csv/transaction.ts:75` calls it a hint and says it is "never
   trusted as a key", and `docs/research/01-csv-import.md:484-486` is explicit: "Do not use it as
   the app's own category. Keep it as an import hint that seeds categorization rules; the
   app's categories need stable IDs with localized display names." So this feature has two
   models to add, not one, and `bankCategory` is a **source of suggested rules**, never the
   category itself.

2. **"Match on IBAN" cannot be shown in the UI today.** `Transaction.counterpartyIban` exists
   in the database (`schema.prisma:71`) but is absent from `TransactionPayload`
   (`packages/core/src/api.ts:17-30`), which is the only shape `apps/web` ever sees. A rule
   matching on IBAN would be unexplainable on screen and unpreviewable in the browser. The
   contract has to grow a field. While it is being extended, `creditorId` (`Glaeubiger ID`,
   `DE98ZZZ09999999999` in the fixture) is worth carrying too: for SEPA direct debits it is a
   far stabler key than a payee name a merchant rewrites.

3. **"Manual override per transaction" has no write path to hang off.** `TransactionController`
   (`apps/api/src/accounts/account.controller.ts:50-59`) exposes exactly one route — the soft
   delete, `DELETE /api/transactions/:id` — and `apps/web/src/api/client.ts` has no function
   that calls it, so that route is server-only today. Setting a category by hand is the first
   edit the app has ever made to a stored row.

4. **Rules CRUD is the first request body too big to hand-validate comfortably.** There is no
   `ValidationPipe` in `main.ts` and no `class-validator` dependency; `account.controller.ts:20-25`
   hand-rolls `requireString`. That is fine for `{ iban, name }`. A rule is
   `{ field, operator, value, priority, categoryId }`, and the web form needs the same checks
   client-side. See §7 for the two honest options.

5. **`apps/web` is a single-route, hard-coded-German app.** `App.tsx:9-16` declares one route,
   with a comment saying the router exists because "the next two are pages rather than tabs on
   this one" — so `/rules` is the anticipated shape, but there is no navigation component of
   any kind yet, and every visible string outside `src/i18n/importErrors.ts` is inline German.

## Detailed findings

### 1. The seam: what can live in `packages/core`

`.dependency-cruiser.cjs:13-31` forbids `packages/core/src` from importing `@nestjs`, `@prisma`,
`react` or `react-dom`, and `tsPreCompilationDeps: true` (`:49`) makes type-only imports visible,
so `import type { Prisma } from '@prisma/client'` fails `pnpm lint:deps` like any other. On top
of that, `packages/core/tsconfig.json` sets `"types": []`, so core has no Node globals at all.

Everything a rules engine needs to _decide_ — normalize a string, test a keyword, walk an
ordered list, return a category id — needs none of that. Everything it needs to _persist_ needs
all of it. That is the same split the import already made:

> Core produces the canonical string; `apps/api` hashes it.
> — `packages/core/src/csv/fingerprint.ts:7-8`

`fingerprintInput` is pure and in core; `dedupKeyHash` is in `apps/api/src/import/hash.ts`
because `node:crypto` does not typecheck under `"types": []`. Rules follow the identical shape:
`categorize(rules, transaction)` in core, the `UPDATE` in `apps/api`.

One consequence is worth stating because it is a genuine benefit and not just tidiness. Core's
**root** entry is browser-safe by construction — `packages/core/src/index.ts` deliberately does
not re-export the CSV parser, because `csv-parse/sync` uses `Buffer` and `apps/web` bundles the
root entry. A matcher put in `rules/` and exported from the root entry is therefore usable _in
the browser_, so the rule editor can show "this matches 23 of the 412 loaded transactions" as
the user types, with no endpoint and no round trip.

### 2. What there is to match on

The database row (`apps/api/prisma/schema.prisma:50-90`) and the shape the browser sees
(`packages/core/src/api.ts:17-30`) are not the same set:

| Field              | `Transaction` (DB) | `TransactionPayload` (UI) | Useful to match on                         |
| ------------------ | ------------------ | ------------------------- | ------------------------------------------ |
| `counterpartyName` | yes                | yes                       | **yes** — the brief's "payee keyword"      |
| `purpose`          | yes                | yes                       | **yes** — `Verwendungszweck`               |
| `counterpartyIban` | yes                | **no**                    | **yes** — the brief's IBAN match           |
| `creditorId`       | yes                | no                        | yes — stabler than payee for direct debits |
| `mandateRef`       | yes                | no                        | occasionally                               |
| `bookingText`      | yes                | yes                       | as a coarse type (`FOLGELASTSCHRIFT`)      |
| `amountCents`      | yes                | yes                       | out of scope per the brief                 |
| `bankCategory`     | yes                | yes                       | as a rule **suggestion**, never a key      |

Two properties of the real data matter for the matcher, both pinned by existing tests:

- **`purpose` can contain a line break.** `packages/core/src/csv/parse.test.ts:72` asserts
  `'Miete Oktober\r\nHauptstraße 12'`, and `TransactionList.tsx:54` renders it with
  `whiteSpace: 'pre-line'`. A user typing `Miete Oktober Hauptstraße` as a keyword gets no
  match unless whitespace is collapsed first.
- **`counterpartyName` can be absent.** That same rent row has no
  `Beguenstigter/Zahlungspflichtiger` — which is exactly the case where only the purpose
  identifies the transaction, and exactly why purpose matching is in the brief. Both fields are
  `String?` in the schema and `string | null` in the payload; the matcher takes
  `string | undefined | null` and treats it as the empty string rather than matching or throwing.

### 3. Case-insensitive matching in German — measured

This is the finding that decides the architecture. Measured on this checkout, SQLite 3.53.2 via
`better-sqlite3@12.11.1`:

```
LIKE '%rewe%'     → ["REWE SAGT DANKE"]        ASCII folding works
LIKE '%müller%'   → []                          MÜLLER GmbH not matched
LIKE '%MÜLLER%'   → ["MÜLLER GmbH"]             only the exact case
lower('MÜLLER')   → "mÜller"                    the Ü survives
'…' = '…' COLLATE NOCASE                        same ASCII-only limit
```

SQLite's built-in `LIKE`, `lower()`, `upper()` and `NOCASE` fold **ASCII A–Z only**; every byte
above 0x7F is left alone unless the build carries ICU. The fixtures are full of them:
`Müller GmbH`, `Ärzte GmbH`, `Hauptstraße`, `Möbel für die Küche`.

Prisma offers no way out on this provider. The generated client in this repo
(`apps/api/src/generated/prisma/commonInputTypes.ts:17-29`) defines `StringFilter` with
`equals / in / notIn / lt / lte / gt / gte / contains / startsWith / endsWith / not` — and **no
`mode` field**. `mode: 'insensitive'` is a PostgreSQL and MongoDB feature; it is not in this
client's types, so it will not even compile.

JavaScript has the opposite property, measured the same way:

```
'MÜLLER GmbH'.toLowerCase() === 'müller gmbh'      → true
'Mu' + U+0308 + 'ller' === 'Müller'                → false   (NFD vs NFC)
  …the same two, each .normalize('NFKC') first     → true
```

The normalizer that handles all of this **already exists in core** and is exactly right:

```ts
// packages/core/src/csv/fingerprint.ts:16-18
function normalize(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}
```

NFKC settles the composed/decomposed umlaut, `\s+` collapse settles the CRLF inside
`Verwendungszweck`, `toLowerCase` settles `MÜLLER`. It is module-private today —
`packages/core/src/index.ts:12` exports `assignOccurrences`, `dedupKeyInput` and
`fingerprintInput`, not `normalize`. Lifting it into `rules/normalize.ts` and importing it from
both places is the single cheapest move in this feature, and it keeps the two subsystems
agreeing on what "the same text" means.

**Performance is not a reason to push matching back into SQL.** Measured here, on synthetic rows
shaped like the fixtures:

```
normalize 50 000 rows            →  21 ms
50 000 rows × 20 rules, matching →   6 ms
```

Fifty thousand rows is roughly a decade of one household's statements, which per `CLAUDE.md`
("the data is one person's bank history") is the whole scale this app is ever asked to handle.
Thirty milliseconds of CPU is not the cost of a re-apply — the round trip and the writes are.

### 4. Rule shape, operators and priority

**Fields and operators.** The brief names three match targets, which map onto two behaviours:

- `counterpartyName`, `purpose` → substring, on normalized text.
- `counterpartyIban` → equality, on the IBAN normalizer that already exists
  (`fingerprint.ts:20-22`: `normalize` then strip spaces), because a user pastes
  `DE89 3704 0044 0532 0130 00` with grouping spaces as often as without.

`startsWith` / `endsWith` cost nothing to add over the same normalized string and remove the
most common substring false positive. User-authored **regex is the one option worth arguing
about** — see §10.

**Priority.** "Rules have a priority" admits two readings, and they differ in what the user
sees:

- _First match wins on a total order._ One rule decides. Predictable, explainable in one line
  ("categorized by rule #3"), and the right fit for a single `categoryId` column.
- _All rules apply, last write wins._ Equivalent in outcome for a single-valued assignment, but
  worse to explain and worse to debug.

First-match-wins is the better fit here — but note that **no engine surveyed in §9 actually does
it**. Firefly III and Actual Budget both run every matching rule in order and let the last
assignment win; Firefly III gets first-match-wins behaviour only when a rule opts in with
`stop_processing`. For a single-valued `categoryId` the two are outcome-equivalent under a
consistent order, so the choice is about what the UI can say: "categorized by rule #3" is a
sentence; "rule #3 won because it ran last" is not. Choosing first-match-wins means choosing the
explainable one, with the survey's caveat that it is the less common design.

It needs a **deterministic tiebreak**, because two rules can carry the same integer priority:
order by `(priority ASC, createdAt ASC, id ASC)`.
The repo already cares about this specific kind of determinism —
`assignOccurrences` is documented as "Deterministic and database-free: the same file always
yields the same indices" (`fingerprint.ts:56-58`) — and the same standard should hold here, so
that a re-apply produces the same result twice and a core unit test can assert it without a
database.

**Where the ordering is applied is a real choice.** Sorting in core (a pure
`orderRules(rules)`) keeps the tiebreak testable without Prisma and identical in the browser
preview; sorting in the SQL `orderBy` puts it where the rows come from but makes the browser
preview a different code path. Core.

### 5. Manual override

The schema already has one idiom for "a human did this, do not undo it": `deletedAt DateTime?`
on `Transaction` (`schema.prisma:85`), plus the documented rule that a re-import **restores**
rather than inserts. A manual category override is the same idea.

Three shapes, with the trade-off stated rather than resolved:

| Shape                                                                | Effective category               | Cost                                                                                        |
| -------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `categoryId String?` + `categorySource String` (`'rule'`/`'manual'`) | `categoryId`                     | Most compact. Clearing an override needs a re-run to refill                                 |
| `categoryId String?` + `manualCategoryId String?`                    | `manualCategoryId ?? categoryId` | Two FKs. Clearing an override falls back instantly, and the UI can show "rules would say X" |
| `categoryId String?` + `categoryLockedAt DateTime?`                  | `categoryId`                     | Mirrors `deletedAt` exactly. Cannot show what the rule would have said                      |

The third is the closest to the only real precedent in the survey (§9): Maybe Finance stores a
`locked_attributes` map of attribute name → lock timestamp, locks exactly the fields a human
touched, and has its rule actions filter on it explicitly. Generalized to a map it would cover
future hand-edits too; as a single `categoryLockedAt` column it is the same idea at this
feature's scope, and it keeps the `deletedAt` idiom the schema already uses. The survey is also
a warning: the three apps without such a column all mis-handle this case, and Firefly III
**cannot** add one, because its category link table has nowhere to record provenance.

Whichever is chosen, **the re-apply write must exclude overridden rows**, and that exclusion is
the single line most likely to be forgotten and least likely to be noticed — a bug here silently
rewrites decisions the user made by hand. It deserves a test named after the behaviour, in the
style of the existing `import.service.test.ts` ("a manual category survives a re-apply that
would have assigned another").

The mirror-image case is worth deciding at the same time: **a row whose rule was deleted or
edited.** If re-apply only ever writes matches, a stale `categoryId` from a rule that no longer
exists survives forever. Re-apply should therefore write `null` for rows that match nothing —
which is also why the "manual" marker cannot simply be "`categoryId` is not null".

There is also a question the brief does not answer: **does an import categorize the rows it
imports?** `ImportSummary` (`api.ts:32-47`) already reports per-outcome counts, and the import
already runs inside one `$transaction` (`import.service.ts:143-199`), so adding a `categorized`
count and a categorize step is cheap. The alternative — import, then press "apply rules" — is
one more manual step every single time. Recommend categorizing on import, but it is the user's
call (see Open questions).

### 6. Storing the assignment, and the mechanics of re-apply

**Store it, do not compute it.** Computing the category at read time would remove the need for a
re-apply endpoint entirely, and would never go stale. It loses on the third product step:
`CLAUDE.md` says the product is "import → categorize → report", and a monthly report is
`GROUP BY categoryId, substr(bookingDate, 1, 7)` — which needs a column. The brief asks for
re-apply, which is the same answer from the other direction.

**The write.** `updateMany` sets one value across every matched row, so a re-apply cannot be a
single statement — different rows get different categories. The shape that fits both Prisma and
the existing code is: categorize in memory, **group the row ids by resulting category**, and
issue one `updateMany` per category plus one for the rows that matched nothing. That is
`O(categories)` statements rather than `O(rows)`, and it is exactly the shape
`import.service.ts:186-189` already uses to restore soft-deleted rows:

```ts
await tx.transaction.updateMany({
  where: { id: { in: toRestore } },
  data: { deletedAt: null },
});
```

Wrap the whole thing in `this.prisma.$transaction(async (tx) => …)` as the import does, so a
crash cannot leave half the history recategorized.

**One measured limit, and the measured reason it does not bite.** Raw SQLite on this build
accepts at most **32 766 bound parameters**; 32 767 fails with `too many SQL variables`. But
Prisma does not hand a large `in` list straight through: measured here against `data/test.db`,
an `updateMany` with `id: { in: [...] }` of **40 000** ids returned `count: 40000` without
error, as did a `createMany` of the same size. Prisma 7 chunks internally, so the service does
**not** need to batch the id lists itself.

### 7. The API surface

Conventions to follow, all from existing code:

- Global prefix `api`, set in `main.ts:32`. **No global `ValidationPipe`** — `main.ts` installs
  none, and `class-validator` is not a dependency.
- Controllers are thin and validate by hand: `requireString`
  (`account.controller.ts:20-25`) throwing `BadRequestException`.
- Services own the Prisma calls, map `P2002` to `ConflictException`
  (`account.service.ts:47-49`), and throw `NotFoundException` from a `requireX` helper
  (`account.service.ts:64-70`).
- Deletes return 204 via `@HttpCode(204)` (`account.controller.ts:56`).
- Services return **core types**, never Prisma models — that is what keeps API and UI agreeing.
- Rejections the UI must word are thrown as `BadRequestException({ code, … })`, not a sentence
  (`import.service.ts:234`). `apps/web` reconstructs them as `ApiError` (`client.ts:73-84`) and
  `src/i18n/importErrors.ts` turns the code into German or English. `docs/research/01-csv-import.md:487-490`
  states the principle: "Errors should therefore carry a machine code plus structured data, not
  a pre-formatted sentence."

A surface consistent with that:

```
GET    /api/categories
POST   /api/categories
PATCH  /api/categories/:id
DELETE /api/categories/:id          → 204; needs a decision on rules pointing at it
GET    /api/rules
POST   /api/rules
PATCH  /api/rules/:id
DELETE /api/rules/:id               → 204
POST   /api/rules/apply             → ApplySummary { evaluated, assigned, cleared, skippedManual }
PATCH  /api/transactions/:id        → the manual override (and clearing it)
```

`POST /api/rules/apply` rather than `POST /api/rules/:id/apply`: rules are ordered against each
other, so applying one in isolation cannot honour priority. Scope is the open question —
transactions are account-scoped everywhere in this codebase (`@@unique([accountId, dedupKey])`,
`listTransactions` calls `requireAccount` first), while rules are naturally global. An optional
`accountId` in the body covers both without inventing a second endpoint.

**On validation, the two honest options.** Either keep hand-rolling in the controller — verbose,
duplicated in the web form, but consistent with every other route — or put
`parseRuleInput(body: unknown): RuleInput | RuleInputError` in `packages/core`. The second is
pure, unit-testable without Nest, reusable by the browser form for identical client-side
messages, and produces machine codes rather than sentences, which is what the error pipeline
above already expects. It is more in the spirit of the repo; it is also new machinery. Worth
deciding explicitly in the plan rather than drifting into.

### 8. The web UI

`apps/web` has one route and no navigation. `App.tsx:5-8` anticipates this exact change:

> One route today. The router is here because the product is import → categorize → report, and
> the next two are pages rather than tabs on this one.

Conventions a `RulesPage` inherits:

- **State is plain hooks.** No Redux, no TanStack Query. `AccountPage.tsx:29-46` loads on mount
  with an `AbortController`; `:51-74` keeps the in-flight request in a `useRef` and aborts the
  previous one so a slow response cannot land under the wrong account. A rules page reloading
  after every save wants the same guard.
- **Multi-state panels are discriminated unions**, not booleans — `ImportPanel.tsx:19-23` uses
  `{ status: 'idle' | 'uploading' | 'done' | 'error' }`. A re-apply button has the same four
  states and should use the same shape.
- **MUI, `sx` props, no styled-components.** `TextField`, `Button`, `Stack`, `Card`, `Alert`,
  `Table*`, `MenuItem`, `CircularProgress` are all in use.
- **Strings are inline German.** `'Konto'`, `'Anlegen'`, `'Noch keine Umsätze. Importieren Sie
einen CSV-Export.'` A rules UI introduces more new user-facing text than every existing page
  combined — labels, operator names, empty states, confirmations. `src/i18n/importErrors.ts`
  already defines `type Locale = 'de' | 'en'` and a message map; whether rules text follows it
  or stays inline is a decision worth making once, now, rather than per component.
- **Amounts and dates are formatted at the edge** by `src/format.ts` (`formatAmount`,
  `formatBookingDate`), never in core.

The browser-side preview described in §1 is the piece worth designing around: because
`categorize()` is exported from core's browser-safe root entry and the page already holds
`TransactionPayload[]`, the rule editor can show matches live. That requires
`counterpartyIban` on the payload (§2) or IBAN rules silently preview as non-matching.

**Testing.** Unit: `vi.mock('../api/client', …)` with hand-written resolvers
(`AccountPage.test.tsx:15-24`), and a `transaction(overrides)` builder
(`TransactionList.test.tsx:7-21`) — a `rule(overrides)` builder is the obvious twin. E2E:
`test.describe.serial` with `getByLabel` / `getByRole` selectors (`e2e/import.spec.ts`), against
a throwaway `e2e.db` that `scripts/reset-e2e-db.mjs` recreates. The natural E2E is: import the
existing fixture, create a rule on `Müller`, apply, assert the row shows the category — which
also proves the umlaut path end to end, the way the import tests do.

**No new fixtures are needed.** `fixtures/sparkasse-camt-18.csv` already contains
`Müller GmbH`, `Ärzte GmbH`, `REWE SAGT DANKE; FILIALE 42`, `Hotel "Nord" GmbH`, a rent row with
an empty payee and a CRLF inside its purpose, and a `Glaeubiger ID`. Every matcher edge case in
§2 and §3 has a row already.

### 9. Prior art

Five engines were read in source rather than in documentation. Two are the real design poles, and
they disagree about the thing the brief is most specific about — priority.

**Firefly III — declared, stored priority.** `rule_groups.order` then `rules.order`, both `ASC`
(`SearchRuleEngine::fireGroup`). A `strict` boolean decides AND vs OR: strict folds every trigger
into one query, non-strict runs one query per trigger and unions the results. `stop_processing`
exists at three levels with three meanings — on a rule it halts the rest of that group, on a
trigger (non-strict only) it stops at the first trigger that finds anything, on an action it
stops later actions. Operators are the search vocabulary, four per text field
(`_is / _contains / _starts / _ends`), negated by a `-` prefix. **No regex at all**, by policy:
"the Firefly III rule engine is supposed to be basic." Re-apply is a CLI command filtered by
date, account and rule, plus `POST /v1/rules/{rule}/trigger` with a `/test` dry run alongside it.

**Actual Budget — derived priority.** There is no order column at all. `computeScore()` sums
per-operator scores (`is` 10, `oneOf` 9, `isapprox`/`isbetween` 5, `gt`/`lt` 1,
`contains`/`matches` 0), doubles the total when every condition is an exact-ish operator, sorts
**ascending**, and breaks ties by rule id. Least specific runs first, most specific last, last
write wins. A `conditions_op` column holds `'and'`/`'or'` and is evaluated as `every`/`some`.
Strings are lower-cased at parse time — "All strings are matched case-insensitive." Users cannot
reorder rules at all, which is the part they find surprising.

**Nobody does pure first-match-wins.** Every engine surveyed runs _all_ matching rules in a
defined order and lets the last assignment win; explicit early exit exists only as Firefly III's
`stop_processing`. For a single-valued `categoryId` the two are outcome-equivalent given a
consistent order — what differs is what can be explained on screen. A brief that says "rules have
a priority" is asking for Firefly III's stored order, not Actual's derived one.

**Manual override: one real precedent in the survey.** Maybe Finance puts a `locked_attributes`
jsonb column on the row, mapping attribute name → lock timestamp, with a
`WHERE NOT (locked_attributes ?| array[:keys])` scope. Its controller calls
`lock_saved_attributes!` on every create and update, locking exactly the fields that request
touched, and the rule action opts in with `scope.enrichable(:category_id) unless
ignore_attribute_locks`. A `data_enrichments` audit table records one row per
(record, source, attribute). The concern's own header is the policy: "User edits always take
highest precedence."

Everyone else works around its absence, and the workarounds are instructive:

- **Actual** has no category lock. `reconciled` is a reconciliation lock honoured on sync only.
  Re-sync coalesces `existing.category || incoming.category` — provenance-blind, so a rule-set
  category is protected exactly as much as a hand-set one. Its manual-entry path does guard
  ("rules only fill fields the user left empty, so their manual input isn't overwritten"), but
  the bulk "Run Rules" action bypasses that guard entirely.
- **Firefly III refused it.** The `category_transaction_journal` link table has no timestamps and
  no source column, so there is physically nowhere to record provenance. The maintainer's answer
  to the request: "Yes. That will not change, sorry." The offered workaround is authoring a
  `has no category` trigger — which only works in strict mode, because non-strict unions trigger
  results rather than intersecting them.
- **YNAB** sidesteps the problem by having no retroactive re-run: "The category of existing
  transactions in the register will not be affected."
- **Monarch** has `businessEntityOverriddenAt` and `ownershipOverriddenAt` — and no
  `categoryOverriddenAt`.

Two patterns converge across four of them: repeated human edits get promoted into a
**payee-level default** rather than a row flag (Actual learns a `payee → category` rule once 3 of
the last 5 agree), and the opt-out offered is **per payee**, not per transaction.

**German bank data confirms the field ranking in §2.** EPC130-08 §1.5.2 requires the Creditor
Identifier to be "stable over time"; §4.8.24 lists a change of the creditor **name** as a routine,
supported mandate amendment. There is no stability guarantee for the payee name at all. Meanwhile
the EPC's own `Verwendungszweck` example embeds a timestamp and a per-purchase number, and
GnuCash's wiki documents the consequence directly: on `123456/201501`-shaped strings "the date
changes each month ... the good information of the customer id is lost." Actual ships roughly 45
bank-specific adapters to normalise this one field; its Commerzbank adapter reassembles the
140-character truncation and repairs split German labels, with the comment "Other splits will
need to be fixed by user with rules."

One counterexample worth remembering before ranking fields globally: PayPal's creditor name is
the constant `PayPal (Europe) S.a.r.l. et Cie., S.C.A.`, and the actual merchant appears only
inside the purpose text. Field choice has to be per rule.

**Learned categorization is the road not taken.** GnuCash's Bayesian import matcher (tokens from
description, day-of-week and split memos; a 0.90 threshold; token → account counts in KVP slots)
and Beancount's `smart_importer` (a linear SVC over narration, payee and day-of-month) are both
learned rather than declared, and neither offers a declared-rule mode — `smart_importer`'s request
for a regex override file was closed unimplemented. Their lesson here is about UI debt: once you
learn mappings you are forced to build something to inspect them, and GnuCash's Import Map Editor
is **delete-only** — it still cannot express "add this rule." A declared engine starts where that
retrofit ended up.

Sources read: `firefly-iii/firefly-iii` (`SearchRuleEngine.php`, `config/search.php`, the rules
migrations), `actualbudget/actual` (`rules/rule.ts`, `rules/condition.ts`, `rules/rule-utils.ts`,
`app-gocardless/banks/*`), `maybe-finance/maybe` (`concerns/enrichable.rb`, migration
`20250416235420`), `Gnucash/gnucash` (`import-backend.cpp`, `Account.cpp`),
`beancount/smart_importer`, EPC130-08, and the YNAB OpenAPI spec.

### 10. Regex in user-authored rules — measured

Substring matching is enough for the brief as written. Regex is the natural "power user" next
ask, so the cost is worth recording now.

Measured on this checkout, Node v24.15.0, the classic nested quantifier `/^(a+)+$/` against
`'a'.repeat(n) + 'X'`:

```
20 chars →     20 ms
24 chars →     79 ms
26 chars →    312 ms
28 chars →  1 261 ms
```

Roughly 4× per two characters — exponential, single-threaded, and on the event loop. A
34-character `Verwendungszweck` would take minutes. For comparison, 100 000 substring matches
over the same haystack took **2 ms**.

The important qualifier: this app is local, single-user, and unauthenticated by design
(`CLAUDE.md` WHY). A pathological pattern here is not an attack — it is the user freezing their
own API with their own rule. That makes it a **usability** problem rather than a security one,
which changes the appropriate response: not a sandbox, but either (a) no regex, or (b) regex
behind a length cap and a documented "keep it simple" note, ideally with the pattern compiled
once in core and rejected at validation time if it is obviously nested-quantifier shaped.

The prior art splits cleanly on this. Firefly III ships **no regex at all** and says so as
policy. Actual Budget ships `matches` as `new RegExp(this.value).test(fieldValue)` evaluated
**once per row** inside a table scan, with no timeout, no compiled-pattern cache, and a
`try/catch` that only catches construction errors — while its `contains` path escapes every
special character and LRU-caches 500 compiled patterns, so it is structurally incapable of
backtracking. If regex is ever added here, compile it at rule-save time, surface the syntax
error in the editor, and cache the compiled object; never construct one inside the row loop.

Recommendation: ship substring + startsWith/endsWith + IBAN equality first. They cover the
fixtures completely. Add regex only when a real rule cannot be expressed without it — and note
that when Stack Overflow's 2016 outage was traced to a regex over a long whitespace run, the
published fix was "This regular expression has been replaced with a substring function."

## Code references

- `.dependency-cruiser.cjs:13-31` — `core-stays-framework-free`; `:49` `tsPreCompilationDeps`
  makes type-only Prisma imports fail too
- `packages/core/src/index.ts:1-6` — why the root entry is browser-safe, and why `rules/`
  belongs in it
- `packages/core/src/index.ts:12` — `normalize` is **not** exported; only `fingerprintInput`,
  `assignOccurrences`, `dedupKeyInput`
- `packages/core/src/csv/fingerprint.ts:16-22` — the NFKC + whitespace + lowercase normalizer,
  and the IBAN variant, both module-private
- `packages/core/src/csv/fingerprint.ts:7-8` — the purity precedent: core canonicalizes,
  `apps/api` hashes
- `packages/core/src/api.ts:17-30` — `TransactionPayload`; no `counterpartyIban`, no
  `creditorId`
- `packages/core/src/csv/transaction.ts:75` — `bankCategory` is "never trusted as a key"
- `apps/api/prisma/schema.prisma:50-90` — `Transaction`: what exists to match on, and
  `deletedAt` as the "a human did this" precedent
- `apps/api/prisma/schema.prisma:18-25` — `Account`; there is no `Category` model anywhere
- `apps/api/src/generated/prisma/commonInputTypes.ts:17-29` — `StringFilter` with no `mode`
- `apps/api/src/accounts/account.controller.ts:20-25` — hand-rolled `requireString`; no
  `ValidationPipe` in `main.ts`
- `apps/api/src/accounts/account.controller.ts:50-59` — `TransactionController`; the only write
  on a stored row, and `apps/web` never calls it
- `apps/api/src/accounts/account.service.ts:47-49,64-70` — `P2002` → `ConflictException`;
  `requireAccount` → `NotFoundException`
- `apps/api/src/import/import.service.ts:143-199` — the `$transaction` orchestration a re-apply
  should copy; `:186-189` the grouped `updateMany`
- `apps/api/src/import/import.service.ts:234` — `BadRequestException({ code, columns })`
- `apps/web/src/App.tsx:5-16` — one route, and the comment anticipating this page
- `apps/web/src/api/client.ts:73-84` — `ApiError` reconstructed from `{ code, columns }`
- `apps/web/src/pages/AccountPage.tsx:29-81` — the `AbortController` + `useRef` load pattern
- `apps/web/src/pages/ImportPanel.tsx:19-23` — the discriminated-union panel state
- `apps/web/src/pages/TransactionList.tsx:54` — `purpose` rendered `pre-line`, because it
  contains newlines
- `packages/core/src/csv/parse.test.ts:72` — `'Miete Oktober\r\nHauptstraße 12'`
- `docs/research/01-csv-import.md:480-493` — the bilingual section: `bankCategory` seeds rules,
  errors are codes not sentences
- `CLAUDE.md` RULES — core stays framework-free; research in `docs/research/`

## Decisions confirmed (2026-09-23)

Six of the seven open questions were settled by the user while planning; the seventh was settled
by measurement. They are recorded here rather than only in the plan, because this document is
what the next person reads first.

1. **A rule holds one condition**, not several — `field`, `operator`, `value`, `priority`,
   `categoryId`, `active`. This is what the brief describes, it needs no join table, and
   combining is done by writing two rules. Both surveyed engines support multiple conditions, so
   it is the likeliest thing to be outgrown; a `RuleCondition` table later is additive.
2. **The override is `categoryLockedAt DateTime?`** — the `deletedAt` mirror of §5's third shape.
   Chosen over the two-column and attribute-map variants for matching an idiom the schema already
   has.
3. **Import categorizes the rows it inserts**, inside the import's existing `$transaction`, and
   `ImportSummary` gains a `categorized` count. The alternative was a manual step after every
   import, forever.
4. **Re-apply is global** — `POST /api/rules/apply`, no body, every account. Rules are global, so
   a per-account button would leave other accounts silently stale with no way to tell.
5. **Deleting a category in use is refused**, 409 with the rule and transaction counts, mirroring
   the duplicate-IBAN conflict. Nulling the references would silently discard hand-set categories.
6. **Rule input is parsed by `parseRuleInput()` in `packages/core`** — the §7 option that gives
   the browser form and the API the same checks and emits machine codes into the existing
   `ApiError` → `src/i18n` pipeline.
7. **Rules UI text goes in `src/i18n`**, following `importErrors.ts`'s `Record<Locale, …>` plus
   `locale: Locale = 'de'` default parameter — no locale switcher, no context. The three existing
   pages keep their inline strings for now.

Question 6 in the original list — whether Prisma chunks a large `in` list — was answered by
measurement and is folded into §6 above: it does, at 40 000 ids.

## Still open

- **Should `bankCategory` seed suggested rules?** `docs/research/01-csv-import.md:484-486`
  proposes it, the fixture carries `Wohnen`, and it would make the empty state useful — but it is
  scope beyond the brief and is explicitly excluded from the plan.
- **Amount and date conditions.** Out of scope today; they are the first thing a one-condition
  rule cannot express.

## Next step: the implementation plan

Written: [`docs/plans/02-categorization-rules.md`](../plans/02-categorization-rules.md). It
follows the sequencing below, grouped into five phases.

Sequencing that keeps each step testable with the tools it already has:

1. `packages/core/src/rules/normalize.ts` — lift `normalize`/`normalizeIban` out of
   `fingerprint.ts`, re-import them there, export from the root entry. Pure, no behaviour change;
   the existing fingerprint tests are the regression net.
2. `rules/rule.ts` + `rules/match.ts` in core — `Rule`, `RuleField`, `RuleOperator`,
   `matchRule`, `orderRules`, `categorize`. Unit-tested against the fixture's own strings
   (`MÜLLER`, `Ärzte`, the CRLF purpose, the empty payee) with no database.
3. `Category` and `Rule` models plus the two `Transaction` columns; `pnpm --filter
@household-budget/api db:push`.
4. `CategoryPayload`, `RulePayload`, `ApplySummary` in `packages/core/src/api.ts`;
   `TransactionPayload` gains `categoryId` and `counterpartyIban`. This is the step that breaks
   `pnpm typecheck` in both apps until both are updated — by design.
5. `apps/api/src/rules/` — CRUD, then `POST /api/rules/apply` with the grouped `updateMany`
   inside a `$transaction`, then `PATCH /api/transactions/:id`. Service tests against the real
   test database, in the style of `import.service.test.ts`.
6. `apps/web` — client functions, `/rules` route, navigation, the rules page, the category
   control on the transaction row. Unit tests with `vi.mock`, then one Playwright spec that
   imports the fixture, creates a `Müller` rule, applies it, and asserts the category lands.

Steps 1, 2 and 4 are pure `packages/core` work, testable with Vitest and no database. Run
`pnpm check` at the end of every step and `pnpm check:all` at the end of step 6.
