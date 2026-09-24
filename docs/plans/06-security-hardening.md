---
date: 2026-09-24T08:35:06Z
git_commit: 0e37f0da23872b5dd69539b31f06d169cb4f8f7e
branch: test/e2e-monthly-totals
topic: 'Security hardening: loopback-only API, bounded uploads, bounded row errors, safe logging, repo hygiene'
tags: [plan, security, apps-api, apps-web, packages-core, import, gitignore]
status: ready
---

# PLAN: Security hardening

Fixes the findings of the security review in
[docs/reports/2026-09-24-security-review.html](../reports/2026-09-24-security-review.html). That
report is the authority for _what_ is wrong and where; do not re-derive it. Its **Tracking**
section is updated at the end of every phase below, so the report stays the one place to see
which finding is open, planned or fixed.

The app is local by design (CLAUDE.md → WHY): no auth, single user, SQLite on the user's
machine. This plan keeps that. It does not add auth; it makes "local" true at the network layer
and bounds what a single upload can cost.

**No new dependencies, no schema change, no migration.**

## Acceptance Criteria

- [x] The API listens on `127.0.0.1` only; it is not reachable from another host on the LAN.
- [x] No response from the API itself (`:3000`) carries an `Access-Control-Allow-Origin` header.
      (Vite's own dev-server CORS middleware may still add one to proxied responses for a loopback
      Origin; that is Vite's same-machine behaviour and out of scope.)
- [x] A request whose `Host` is not loopback (e.g. `evil.com:3000`) gets `403`.
- [x] A request whose `Origin` header is present and not loopback (e.g. `https://evil.com`,
      `null`) gets `403`.
- [x] Requests through the Vite proxy (`:5173` dev, `:5174` e2e) and direct loopback `GET`s still
      work; `pnpm check:all` is green.
- [x] An upload with more than 5 non-file fields, a field value over 1 KB, or a second file gets
      `400`; a file over 10 MB still gets `413`.
- [x] A CSV uploaded as `text/plain`, `application/octet-stream` or with an empty type imports
      normally.
- [x] An upload typed `image/png` or `application/pdf` gets `400 { code: 'UNSUPPORTED_CONTENT_TYPE' }`,
      shown in German in the import panel.
- [x] `RowError.value` is never longer than 100 characters plus `…`.
- [x] The import response carries at most 100 entries in `failed` and the true total in the new
      `failedCount`; `ImportBatch.rowsFailed` stores the true total.
- [x] One import writes at most 100 row-error log lines, plus one summary line when capped.
- [x] `fileName` and row `value` reach the log with no raw CR, LF, ESC or other control character.
- [x] The import panel shows `{failedCount} fehlerhaft`, and `… und N weitere` under the list when
      capped.
- [x] `.gitignore` covers `*.db-wal`, `*.db-shm` and `dogfood-output/screenshots/`;
      `dogfood-output/report.md` stays committable (plan 05 links it as its findings log).
- [x] The report's Tracking section marks every finding fixed, with the phase that fixed it.

## Technical Key Decisions and Tradeoffs

1. **Network: bind `127.0.0.1`, remove CORS, add a loopback guard** (review #1, option B).
   - Why: binding closes LAN access; removing CORS closes cross-site reads; the guard closes
     cross-site "simple" POSTs (`POST /api/imports` multipart, `POST /api/rules/apply` bodyless)
     and DNS rebinding, which binding alone does not.
   - Impact: `main.ts` changes; one new pure function plus an Express-style middleware
     registered with `app.use`. No web change: the Vite proxy forwards the browser's `Origin`
     unchanged — loopback, because the page is served from `localhost`/`127.0.0.1` — and
     `changeOrigin: true` rewrites only `Host`, to the loopback target. A foreign `Origin` also
     passes through Vite untouched (Vite checks `Host` via `allowedHosts`, never `Origin`), so the
     guard sees it and the e2e test below is meaningful.
2. **Guard registered with `app.use` in `main.ts`, not `NestModule.configure`.**
   - Why: it must run before routing and for every path, including 404s; `app.use` avoids the
     Nest 11+/path-to-regexp v8 wildcard syntax question entirely.
   - Impact: the guard is a plain `(req, res, next)` function, typed locally like
     `UploadedCsv` in `import.controller.ts` (no `@types/express` in this app).
3. **Row errors: core truncates `value` to 100 chars; `ImportService` caps the list at 100 and
   adds `ImportSummary.failedCount`** (review #3a, option A).
   - Why: bounded log, response and DOM; the visible count stays honest.
   - Impact: `packages/core` type change (`ImportSummary`), so both apps touch it. Core still
     returns every (truncated) error — the cap is a transport concern, and core tests keep
     seeing the whole report.
4. **MIME: widen the allowlist, return a coded error** (review #2c, option A).
   - Why: real CSVs arrive as `text/plain`, `application/octet-stream` or untyped; the parser
     (`HEADER_NOT_FOUND`) is the real gatekeeper. The list still turns away obvious non-text
     types cheaply.
   - Impact: controller set grows; `UNSUPPORTED_CONTENT_TYPE` gets German/English wording in
     `apps/web/src/i18n/importErrors.ts`. The code stays out of core's `ImportFileErrorCode`,
     which describes what the _parser_ can say.
5. **Multer limits: `files: 1`, `fields: 5`, `fieldSize: 1024`, `parts: 6`, `fieldNameSize: 100`**
   (review #2b).
   - Why: the form carries one file and one ~25-char `accountId`. Nest maps each overrun to a
     `400` (`@nestjs/platform-express` `multer/multer.utils.js` `transformException`), file size
     stays `413`.
   - Impact: one options object in the controller.
6. **Log escaping: `sanitizeForLog()` in `apps/api`**, replaces C0 controls, DEL, C1 controls
   and U+2028/U+2029 with `\uXXXX`, caps at 200 chars (review #3b).
   - Why: `originalname` and cell values are user-controlled; raw CR/LF forges log lines, ESC
     drives the terminal.
   - Impact: used at `import.service.ts:125` (`fileName`) and in `logRowError` (`value`).
7. **Tests without new dependencies.** No `supertest` in `apps/api`: the guard and controller are
   unit-tested by calling them directly; the HTTP-level multer limit and the guard in the running
   stack are covered by Playwright's `request` fixture through the Vite proxy.

## Current State

```
browser ──► Vite :5173 ──proxy /api (changeOrigin)──► Nest :3000   binds all interfaces   main.ts:39
                                                         │  enableCors({ origin: true })  main.ts:35
evil.com page ───── fetch / form POST ──────────────────►│  no Host/Origin check
LAN device ──────── direct ─────────────────────────────►│
                                                         ▼
POST /api/imports ── FileInterceptor({ limits: { fileSize: 10 MB } })   import.controller.ts:37
                 ── mimetype ∈ { text/csv, application/vnd.ms-excel }   :29, :51  (English string error)
                                                         ▼
ImportService.importCsv
  ├─ log file="${fileName}"                         raw                  import.service.ts:125
  ├─ parseSparkasseCsv → errors[]  (every row, value untruncated)        parse.ts:127-129
  ├─ log one line per error, value="${value}" raw                        :136-138, :354-358
  ├─ ImportBatch.rowsFailed = errors.length
  └─ response.failed = errors (all)
                                                         ▼
ImportPanel: "{failed.length} fehlerhaft" + one <li> per error           ImportPanel.tsx:136, :153
```

`.gitignore` covers `data/`, `*.db`, `*.db-journal`, `*.sqlite`, `*.sqlite3`, `.env*` (except `.env.example`)
and `*.csv` outside `fixtures/`. Not `*.db-wal`, `*.db-shm`, `dogfood-output/`.

## Desired End State

```
browser ──► Vite :5173 ──proxy /api──► Nest 127.0.0.1:3000
                                         │ loopbackGuard: Host loopback? Origin absent or loopback?
evil.com page ──────────────────────────►│   no → 403 { code: 'FORBIDDEN_ORIGIN' }
LAN device ────────── ✗ (not bound) ─────┘   no CORS headers at all
                                         ▼
POST /api/imports ── FileInterceptor({ limits: { fileSize, files: 1, fields: 5,
                 │                               fieldSize: 1024, parts: 6, fieldNameSize: 100 } })
                 ── mimetype ∈ { text/csv, application/vnd.ms-excel, text/plain,
                                 application/octet-stream, '' }
                    else 400 { code: 'UNSUPPORTED_CONTENT_TYPE' }
                                         ▼
ImportService.importCsv
  ├─ log file="${sanitizeForLog(fileName)}"
  ├─ parseSparkasseCsv → errors[]   every row, value ≤ 100 chars + "…"
  ├─ log first 100 errors (sanitized) + "import row errors capped: logged 100 of N"
  ├─ ImportBatch.rowsFailed = N
  └─ response.failed = first 100, response.failedCount = N
```

Import panel with more than 100 bad rows:

```
Current                                               Proposed
┌ ⚠ 0 importiert · … · 2431 fehlerhaft ┐              ┌ ⚠ 0 importiert · … · 2431 fehlerhaft ┐
┌ Nicht importierte Zeilen ───────────┐              ┌ Nicht importierte Zeilen ───────────┐
│ • Zeile 2: Betrag nicht lesbar …    │              │ • Zeile 2: Betrag nicht lesbar …    │
│ • … 2431 items, each value unbounded│              │ • … 100 items, values ≤ 100 chars   │
└─────────────────────────────────────┘              │ … und 2331 weitere                  │
                                                      └─────────────────────────────────────┘
```

## Abstractions and Code Reuse

- `.gitignore` - add `*.db-wal`, `*.db-shm`, `dogfood-output/screenshots/`
- `apps/api/src/security/` (new folder)
  - `loopback.ts` - new
    - `isLoopbackHost(hostname)` - `localhost`, `127.0.0.0/8`, `::1` / `[::1]`
    - `isLoopbackRequest(host, origin)` - pure decision; `host` from the `Host` header,
      `origin` from `Origin` (`undefined` when absent; the string `null` is not loopback)
    - `loopbackGuard(req, res, next)` - Express-style middleware; `403` JSON
      `{ statusCode: 403, code: 'FORBIDDEN_ORIGIN' }` on reject, logs host/origin at `debug` via
      `sanitizeForLog`
  - `loopback.test.ts` - new
  - `sanitize-log.ts` - new, `sanitizeForLog(value, maxLength = 200)`
  - `sanitize-log.test.ts` - new
- `apps/api/src/main.ts` - `app.use(loopbackGuard)`, remove `enableCors`, `app.listen(port, LISTEN_HOST)`
  with `const LISTEN_HOST = '127.0.0.1'`; log line reads `http://127.0.0.1:${port}/api`
- `apps/api/src/import/import.controller.ts`
  - `UPLOAD_LIMITS` - new const, all multer limits
  - `ACCEPTED_TYPES` - widened
  - `upload` - `BadRequestException({ code: 'UNSUPPORTED_CONTENT_TYPE' })`
- `apps/api/src/import/import.controller.test.ts` - new; constructs `ImportController` with a stub
  `ImportService`
- `apps/api/src/import/import.service.ts`
  - `MAX_REPORTED_ROW_ERRORS = 100` - new const
  - `importCsv` - sanitized `fileName` log; cap logged and returned errors; `failedCount`
  - `logRowError` - sanitized `value`
- `packages/core/src/csv/errors.ts` - `MAX_ERROR_VALUE_LENGTH = 100`, `truncateErrorValue(value)`
- `packages/core/src/csv/parse.ts` - `mapRow`'s `fail` passes `value` through `truncateErrorValue`
- `packages/core/src/api.ts` - `ImportSummary.failedCount: number`
- `apps/web/src/i18n/importErrors.ts` - `UNSUPPORTED_CONTENT_TYPE` in `FILE_MESSAGES` (de/en),
  key type widened with a local `KnownUploadErrorCode`
- `apps/web/src/pages/ImportPanel.tsx` - `ImportResult` reads `summary.failedCount`, renders
  `… und N weitere`
- `apps/web/src/pages/ImportPanel.test.tsx` - new
- `apps/web/e2e/security.spec.ts` - new
- `CLAUDE.md`, `README.md` - one-line notes on bind address and guard
- `docs/reports/2026-09-24-security-review.html` - Tracking section, updated per phase

## Logging & Observability

```
[ImportService] import account=DE89…3000 file="evil\u000a[Nest] fake line.csv" encoding=utf-8
[ImportService] import row 3 AMOUNT_UNPARSEABLE field=Betrag value="12,3,4"
…  (100 lines at most)
[ImportService] import row errors capped: logged 100 of 2431
[LoopbackGuard] rejected host="evil.com:3000" origin="(none)"
```

## Implementation

### Phase 1: Repo hygiene

Dependencies: None

Close the two `.gitignore` gaps (review #6a, #6b).

**Tasks**:

- [x] `.gitignore`: add `*.db-wal` and `*.db-shm` next to `*.db-journal` in the household-budget
      block.
- [x] `.gitignore`: add `dogfood-output/screenshots/` with a one-line comment (screenshots may
      show local data). Not the whole folder: `docs/plans/05-dogfood-fixes.md` links
      `dogfood-output/report.md` as its findings log, so the report must stay committable.
- [x] Report: Tracking rows 6a, 6b → Fixed (Phase 1), change-log entry.

**Automated Verification**:

- [x] `git check-ignore -q apps/api/x.db-wal && git check-ignore -q x.db-shm && git check-ignore -q dogfood-output/screenshots/initial.png`
      exits 0 (paths outside `data/`, which already covers its own contents).
- [x] `git check-ignore -q dogfood-output/report.md` exits 1 (report stays trackable).
- [x] `git status --short --untracked-files=all` lists no file under `dogfood-output/screenshots/`.
- [x] `pnpm check` passes.

### Phase 2: Loopback-only API

Dependencies: None

Bind to `127.0.0.1`, drop CORS, reject non-loopback `Host`/`Origin` (review #1).

**Tasks**:

- [x] `apps/api/src/security/sanitize-log.ts`: `sanitizeForLog(value: string, maxLength = 200): string`
      — replace `[\u0000-\u001f\u007f-\u009f\u2028\u2029]` with `\uXXXX`, then cap at
      `maxLength` with `…`.
- [x] `apps/api/src/security/sanitize-log.test.ts`: CR/LF, ESC (`\u001b[31m`), C1 (`\u0085`),
      U+2028 escaped; plain umlauts (`Müller`, `Straße`) and `€` untouched; long input capped.
- [x] `apps/api/src/security/loopback.ts`: `isLoopbackHost`, `isLoopbackRequest`, `loopbackGuard`.
  ```ts
  export function isLoopbackRequest(host: string | undefined, origin: string | undefined): boolean {
    if (host === undefined || !isLoopbackHost(hostnameOf(host))) return false;
    if (origin === undefined) return true;
    // `Origin: null` (sandboxed iframe, file://) is not a place this UI is served from.
    const url = URL.parse(origin);
    return url !== null && isLoopbackHost(url.hostname);
  }
  ```
  `hostnameOf` strips the port and IPv6 brackets. Rejection: `res.status(403).json(...)` — type
  `req`/`res` locally (only `headers`, `status`, `json` are used).
- [x] `apps/api/src/security/loopback.test.ts`:
  - accepts `127.0.0.1:3000`, `localhost:3000`, `[::1]:3000`, `127.0.0.2:3000`; with no Origin,
    with `http://localhost:5173`, `http://127.0.0.1:5174`
  - rejects `evil.com:3000`, `192.168.1.10:3000`, `localhost.evil.com`, `127.0.0.1.nip.io`,
    missing Host; Origin `https://evil.com`, `null`, `http://localhost.evil.com`, garbage
  - `loopbackGuard` calls `next()` on accept; on reject sets 403 with
    `code: 'FORBIDDEN_ORIGIN'` and does not call `next()`
  - rejections log at `debug`, not `warn`: a rebinding page can send them in a loop, and an
    info-level line per request would flood the log
- [x] `apps/api/src/main.ts`: `app.use(loopbackGuard)` before `setGlobalPrefix`; delete
      `enableCors` and its comment; `app.listen(port, LISTEN_HOST)` with a comment on why
      (local app, CLAUDE.md WHY); update the startup log URL.
- [x] `apps/web/e2e/security.spec.ts`: through the proxy with the `request` fixture —
      `POST /api/rules/apply` with `Origin: https://evil.com` → 403;
      `GET /api/accounts` with no Origin → 200.
- [x] `CLAUDE.md` line 14: "listens on 127.0.0.1:3000 only; rejects non-loopback Host/Origin
      (`src/security/loopback.ts`)".
- [x] `README.md` §web → api (line ~88): note the API binds `127.0.0.1` and the proxy target is
      `127.0.0.1:3000`.
- [x] Report: Tracking row 1 → Fixed (Phase 2), change-log entry.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/api exec vitest run src/security` passes.
- [x] `pnpm check` passes.
- [x] `pnpm check:all` passes (existing e2e prove the proxy path still works; new
      `security.spec.ts` passes).
- [x] With `pnpm dev` running: `lsof -nP -iTCP:3000 -sTCP:LISTEN` shows only `127.0.0.1:3000`.
- [x] With `pnpm dev` running: `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.com' http://127.0.0.1:3000/api/accounts`
      prints `403`.
- [x] With `pnpm dev` running: `curl -si -H 'Origin: http://localhost:5173' http://127.0.0.1:3000/api/accounts | grep -ci access-control-allow-origin`
      prints `0`.

### Phase 3: Upload limits and content types

Dependencies: Phase 2 (creates `apps/web/e2e/security.spec.ts`)

Bound the multipart form and accept the content types real browsers send for a CSV (review
#2b, #2c).

**Tasks**:

- [x] `apps/api/src/import/import.controller.ts`: `UPLOAD_LIMITS = { fileSize: MAX_BYTES, files: 1, fields: 5, fieldSize: 1024, parts: 6, fieldNameSize: 100 }`,
      passed to `FileInterceptor('file', { limits: UPLOAD_LIMITS })`; comment each non-obvious
      number (one file + one `accountId`).
- [x] Same file: `ACCEPTED_TYPES` adds `text/plain`, `application/octet-stream`, `''`, with a
      comment that the parser's `HEADER_NOT_FOUND` is the real gate; rejection becomes
      `new BadRequestException({ code: 'UNSUPPORTED_CONTENT_TYPE' })`.
- [x] `apps/api/src/import/import.controller.test.ts`: stub `ImportService.importCsv`; each
      accepted type reaches it; `image/png`, `application/pdf` → `BadRequestException` whose
      response has `code: 'UNSUPPORTED_CONTENT_TYPE'`; missing file / blank `accountId` keep
      their existing errors.
- [x] `apps/web/src/i18n/importErrors.ts`: `type KnownUploadErrorCode = 'UNSUPPORTED_CONTENT_TYPE'`,
      added to `FILE_MESSAGES` key type; de: `Dateityp nicht unterstützt — bitte den CSV-Export der Sparkasse hochladen`,
      en: `unsupported file type — upload the Sparkasse CSV export`.
- [x] `apps/web/src/i18n/importErrors.test.ts`: case for `UNSUPPORTED_CONTENT_TYPE` in both
      locales.
- [x] `apps/web/e2e/security.spec.ts`: multipart `POST /api/imports` with 6 extra fields → 400;
      with a 2 KB `accountId` → 400.
- [x] Report: Tracking rows 2b, 2c → Fixed (Phase 3), change-log entry.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/api exec vitest run src/import/import.controller.test.ts` passes.
- [x] `pnpm --filter @household-budget/web exec vitest run src/i18n/importErrors.test.ts` passes.
- [x] `pnpm check` passes.
- [x] `pnpm check:all` passes.

**Manual Verification**:

- [x] In `pnpm dev`, dropping a `.png` on the import panel shows
      "Import fehlgeschlagen — Dateityp nicht unterstützt …".

### Phase 4: Bounded row errors and safe logging

Dependencies: Phase 2 (`sanitizeForLog`)

Truncate error values in core, cap the reported list in the API, keep the count honest in the
UI, and escape user-controlled strings in the import log (review #3a, #3b).

**Tasks**:

- [x] `packages/core/src/csv/errors.ts`: `export const MAX_ERROR_VALUE_LENGTH = 100` and
      `truncateErrorValue(value)` → first 100 UTF-16 units (`.slice(0, 100)`, backing off one unit
      if that splits a surrogate pair) + `…` when longer, so `.length <= 101` always holds. Update the
      `RowError.value` doc comment.
- [x] `packages/core/src/csv/parse.ts`: `fail` in `mapRow` stores `truncateErrorValue(value)`.
- [x] `packages/core/src/csv/parse.test.ts`: a row with a 5 000-char `Betrag` yields
      `AMOUNT_UNPARSEABLE` with `value.length === 101` ending in `…`; existing short-value
      assertions unchanged.
- [x] `packages/core/src/api.ts`: `ImportSummary.failedCount: number` with a doc comment
      ("true total; `failed` is capped").
- [x] `apps/api/src/import/import.service.ts`: `MAX_REPORTED_ROW_ERRORS = 100`; log and return
      `errors.slice(0, MAX_REPORTED_ROW_ERRORS)`; when capped, one
      `import row errors capped: logged 100 of N` line; `failedCount: errors.length`;
      `rowsFailed` unchanged (already `errors.length`).
- [x] Same file: `fileName` in the first log line and `value` in `logRowError` go through
      `sanitizeForLog`.
- [x] `apps/api/src/import/import.service.test.ts`: synthetic CSV (fixture header + 150 rows with
      a bad `Betrag`) → `failed.length === 100`, `failedCount === 150`, stored batch
      `rowsFailed === 150`. (The only `ImportSummary` literal is `import.service.ts:225-235`.)
- [x] `apps/web/src/pages/ImportPanel.tsx`: summary count uses `summary.failedCount`; below the
      list, when `failedCount > failed.length`, a `Typography` `… und {n} weitere`.
- [x] `apps/web/src/pages/ImportPanel.test.tsx`: renders `ImportResult` (export it, or render
      `ImportPanel` with a stubbed `uploadImport`) — capped summary shows `150 fehlerhaft` and
      `… und 50 weitere`; uncapped shows no "weitere".
- [x] Report: Tracking rows 3a, 3b → Fixed (Phase 4), change-log entry; set report status line
      to "all findings fixed".

**Automated Verification**:

- [x] `pnpm core:build` first — apps resolve core through `dist`, so per-package runs see the
      new `ImportSummary` only after it.
- [x] `pnpm --filter @household-budget/core exec vitest run src/csv/parse.test.ts` passes.
- [x] `pnpm --filter @household-budget/api exec vitest run src/import/import.service.test.ts` passes.
- [x] `pnpm --filter @household-budget/web exec vitest run src/pages/ImportPanel.test.tsx` passes.
- [x] `pnpm check` passes.
- [x] `pnpm check:all` passes.

## Implementation Notes

During implementation, document user feedback, problems, and decisions here.

- 2026-09-24: renumbered 05 → 06 (05 is the dogfood-fixes plan). Phase 1 ignores only
  `dogfood-output/screenshots/`, not the whole folder, because plan 05 links
  `dogfood-output/report.md` as its findings log.
- 2026-09-24 planning decisions: Q1 network defence → B (bind + drop CORS + loopback guard);
  Q2 row errors → A (cap 100, truncate 100, `failedCount`); Q3 MIME → A (widen allowlist,
  coded error). Multer limits, log-escaping rules and the no-new-dependency test approach set
  as defaults without a question.

- 2026-09-24 Phase 1: the screenshots under `dogfood-output/screenshots/` were already
  committed in `f320b62` and `dogfood-output/report.md` embeds them, so they stay tracked;
  the new ignore rule covers only screenshots added from now on. Untracking them would be a
  separate `git rm --cached`, left to the user.
- 2026-09-24 Phase 2: `lsof` was not available to the agent, so the bind check ran against a
  throwaway API on port 3200 (e2e database) with `netstat`: `LISTEN 127.0.0.1.3200` only; the
  LAN address does not answer; `Host: evil.com` → 403, `Origin: null` → 403, loopback → 200,
  no `Access-Control-Allow-Origin` for a `localhost:5173` Origin.
- 2026-09-24 Phase 2: `sanitize-log.ts` needs `// eslint-disable-next-line no-control-regex`;
  matching control characters is the regex's whole job.
- 2026-09-24 Phase 4: the summary alert turns `warning` on `failedCount > 0`, not on
  `failed.length`, so it cannot disagree with the count it shows. Added a surrogate-pair test
  for `truncateErrorValue` and a log-cap assertion (101 `warn` calls) in the service test.
- 2026-09-24 after review: `e2e/security.spec.ts` also covers a second file → 400 and an
  11 MB file → 413, closing the last acceptance criterion.

## References

- [docs/reports/2026-09-24-security-review.html](../reports/2026-09-24-security-review.html) — findings and tracking
- `@nestjs/platform-express` `multer/multer.utils.js` `transformException` — multer error → HTTP status
- [docs/plans/01-csv-import.md](01-csv-import.md) — why row errors degrade instead of rejecting the file
- [docs/research/01-csv-import.md](../research/01-csv-import.md) — CSV format authority
