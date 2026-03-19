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

When Gemini bot posts a review on a PR, this skill categorizes every comment by impact and posts a fix queue. When the dev approves fixes with `@agent fix #N`, the agent applies them in priority order.

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

## Agent Fix Rules

- Never auto-fix without explicit dev approval (`@agent fix #N`)
- Read `git-os` SKILL.md before making any commit
- One commit per fix item
- Commit format: `fix(scope): description\n\nResolves review item #N`
- Push to the same PR branch
- Update the report — mark fixed items as `✅ fixed`

## Failure Handling

If a fix cannot be applied cleanly, post a comment explaining the conflict. Never force-push or silently skip a fix.
