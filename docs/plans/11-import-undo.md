---
date: 2026-09-28T21:45:00Z
git_commit: 68e5371e2f899010952d7e2adab07a4c599526f7
branch: fix/import-account-iban-check
topic: 'Removing an upload from /imports, with undo; unknown addresses land on Überblick'
tags: [plan, csv-import, apps-api, apps-web, undo]
status: implemented
---

# PLAN: Remove an import, and a catch-all route

Found by dogfooding a Deutsche Bank file imported into the Sparkasse account (see plan 01,
Later changes, 2026-09-28): once a file lands in the wrong account, nothing in the UI took it
out again. And `/importe` — the German word for a page whose address is English — rendered an
empty frame.

## Decisions

1. **Soft, not hard.** `DELETE /api/imports/:id` soft-deletes the upload's live rows and sets
   `ImportBatch.undoneAt`; `POST /api/imports/:id/restore` reverses it. DESIGN.md makes every
   destructive action undoable for six seconds, and a hard delete could not be. It also keeps
   the invariant that deletion is local: importing the same file again restores the rows.
2. **One timestamp marks the removal.** Rows get `deletedAt = undoneAt`, so a restore brings
   back exactly those, and a row the user had deleted by hand stays deleted. `undoneAt` is
   forced strictly after every earlier `deletedAt` in the batch, so two deletions in the same
   millisecond cannot be confused (a test caught exactly that).
3. **Locks go, as for a single row.** `AccountService.softDeleteTransaction` releases the
   hand-set lock and explains why; a removal does the same. A restore within the six seconds
   still shows the same categories, unlocked.
4. **Only the rows the upload inserted.** Rows it restored belong to an older batch and stay.
   The pending set it replaced when it ran was deleted outright and does not come back; the
   account's next export brings it anew.
5. **A removed upload stays listed**, dimmed, marked „Entfernt“, without a remove button, and
   no longer counts as "already uploaded" for the same file.
6. **Unknown address → `/`**, with `replace`, like the `/budgets` and `/inbox` redirects —
   no separate not-found page for a four-page app.

## Tests

- `import.service.test.ts`: rows hidden and batch marked; restore brings back the same ids; a
  row deleted by hand stays deleted; locks released; re-import after removal is new again;
  idempotent both ways; 404.
- `TransactionsPage.test.tsx` (ImportsPage): remove → snackbar → Rückgängig; removed batch
  marked with no button.
- E2E: `imports.spec.ts` removes the fixture's upload and undoes it; `shell.spec.ts` opens
  `/importe`.

## After pulling

`pnpm --filter @household-budget/api db:push` adds the nullable `undoneAt` column to an
existing `budget.db` without touching its rows.
