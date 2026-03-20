---
name: pr-review
description: Gemini PR review skill. Fetches Gemini bot comments on the PR, categorizes by impact, posts a fix queue, and applies fixes on dev approval in priority order.
license: MIT
metadata:
  author: wednesday-solutions
  version: "2.0"
---

# PR Review — Gemini Fix Queue

## Trigger

Load this skill when a dev wants to **act on PR review comments**:
- "Fix the review comments"
- "Triage the PR feedback"
- "Apply fixes from the review"
- "@agent fix #1 #3"
- "@agent fix all"
- "What do I need to fix in this PR?"

Also triggered automatically by GitHub Actions when Gemini bot posts a PR review.

**Do NOT use this skill for:** creating a new PR (use `pr-create`), or committing code (use `git-os`). This skill only runs on an already-open PR that has review comments on it.

## Priority Order

Fix in this order — lower number = fix first.

| Rank | Category | Examples |
|------|----------|---------|
| 1 | security | auth issues, injection risks, data exposure |
| 2 | breaking | API contract changes, interface changes |
| 3 | logic | wrong conditions, missing edge cases |
| 4 | performance | N+1 queries, unnecessary re-renders |
| 5 | naming | variable/function/class names, casing |
| 6 | style | formatting, whitespace, import order |

**Rule: never fix a style item while a security or breaking issue is pending.**

## Review Report Format

```markdown
# Gemini Review — PR #<n>

| # | Category | File | Issue | Status |
|---|----------|------|-------|--------|
| 1 | security | src/db.js | SQL query not parameterized | ⬜ pending |
| 2 | logic | src/user.js | Missing null check on user.profile | ⬜ pending |
| 3 | naming | src/auth.js | Variable `x` is unclear | ⬜ pending |

To fix: `@agent fix #1 #2`   Fix all: `@agent fix all`
```

## Tools

| Action | Tool |
|--------|------|
| Read a file before applying a fix | `Read` |
| Apply a fix to a file | `Edit` |
| Run git commands (commit, push) | `Bash` |
| Search for a pattern across files | `Grep` |
| Find files by name | `Glob` |

## Agent Fix Rules

- Never auto-fix without explicit dev approval (`@agent fix #N`)
- Read `git-os` SKILL.md before making any commit
- One commit per fix item
- Commit format: `fix(scope): description\n\nResolves review item #N`
- Push to the same PR branch
- Update the report — mark fixed items as `✅ fixed`

## Failure Handling

If a fix cannot be applied cleanly, post a comment explaining the conflict. Never force-push or silently skip a fix.
