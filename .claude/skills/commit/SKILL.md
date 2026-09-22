---
name: commit
description: Commit staged work in household-budget — runs pnpm check first and aborts if it fails, refuses to commit data/ or .env files, then writes a Conventional Commits message from the staged diff. Use for "commit this", "make a commit", /commit.
---

# Commit

Commit staged changes in this repo. Three things happen in order, and each one can stop the commit.

## 1. Gate on `pnpm check`

Run it first, before looking at the diff:

```bash
pnpm check
```

**If it fails, stop.** Do not commit, do not `--no-verify`, do not "fix it in the next commit". Report which step failed and its output, then either fix the cause or hand it back to the user.

`pnpm check` prints one line per step (`format`, `lint`, `deps`, `types`, `unit`) and dumps full output only for the step that failed, so the failure is already the only thing on screen. It takes ~20s and needs no servers.

Do not substitute `pnpm check:all` here. That adds Playwright, which boots two servers — it is the pre-push gate, not the commit gate.

## 2. Refuse forbidden paths

Inspect what is actually staged:

```bash
git diff --cached --name-only --diff-filter=ACMR
```

**Never commit:**

- anything under `data/` — that is the local SQLite database and a developer's real budget data
- any `.env` file. `.env.example` is the single exception and is fine to commit
- any `*.db`, `*.sqlite`, `*.sqlite3`
- bank exports (`*.csv`, `*.ofx`, `*.qfx`, `*.qif`, `*.xls`, `*.xlsx`) outside a `fixtures/` directory

If any staged path matches, unstage it and tell the user which file and why:

```bash
git restore --staged <file>
```

Do not commit the rest silently as if nothing happened — say what you dropped.

This mirrors `scripts/check-staged-data.mjs`, which the pre-commit hook runs anyway. Checking here too means the user gets a clear explanation instead of a hook rejection, and it catches the case where someone is about to reach for `--no-verify`.

## 3. Write the message

Read the staged diff — not the file list, the actual diff — and describe what it does:

```bash
git diff --cached
```

Format: `<type>[optional scope]: <subject>`

| Type       | Use for                                               |
| ---------- | ----------------------------------------------------- |
| `feat`     | new behaviour a user of the app or API can observe    |
| `fix`      | a bug fix                                             |
| `refactor` | restructuring with no behaviour change                |
| `test`     | adding or correcting tests only                       |
| `docs`     | documentation only, including CLAUDE.md and README.md |
| `chore`    | tooling, config, dependencies, CI, git hooks          |

Scope is optional and should be the package when it is clearly one: `feat(api):`, `fix(core):`, `chore(web):`.

Subject line: imperative mood ("add", not "added"), lower case, no trailing period, under ~72 chars.

Body: explain **why**, not what — the diff already says what. Wrap at ~72 chars. Include a body whenever the reason is not obvious from the subject; skip it for genuinely trivial changes. If the change fixes something subtle, say what broke and how it broke, so the next person reading `git log` does not have to reconstruct it.

Write the message in normal prose. Do not compress it, even when the session is in a terse output mode — commit messages are read by other people and outlive the session.

## Committing

Use a heredoc so the body keeps its formatting:

```bash
git commit -F - <<'EOF'
<type>: <subject>

<body>
EOF
```

Let the hooks run. Never pass `--no-verify`. If `LEFTHOOK=0` or `LEFTHOOK_EXCLUDE=` seems necessary, that is a decision for the user, not for this skill — ask, and say which gate would be skipped and what it protects.

## After committing

Report the short SHA and subject. Do not push unless asked — and if you do push, this repo's rule is that work lands on `main` only through a reviewed PR, never by committing or pushing to `main` directly.
