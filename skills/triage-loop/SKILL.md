---
name: triage-loop
description: Gemini PR review comment triage and dev-approved fix loop. Fetches bot comments, categorizes by impact, posts REVIEW_REPORT, and applies fixes on dev approval.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
---

# Triage Loop — Gemini PR Review Automation

## Flow

```
Gemini bot posts review comment
        ↓
GitHub Action webhook fires
        ↓
Fetch all bot comments (GitHub API)
        ↓
Haiku: categorize + score each comment (1–6)
        ↓
Generate REVIEW_REPORT.md (sorted ascending by score)
        ↓
Post report as PR comment
        ↓
Dev reviews → comments "@agent fix #1 #3"
        ↓
Agent reads GIT-OS → applies fix → commits → pushes
```

## Priority Scores

| Category | Score | Examples |
|----------|-------|---------|
| Style / lint | 1 | formatting, import order |
| Naming | 2 | variable names, casing |
| Logic | 3 | incorrect conditions, edge cases |
| Performance | 4 | unnecessary re-renders, N+1 queries |
| Breaking change | 5 | API contract changes |
| Security | 6 | auth issues, injection risks |

Sort ascending — safest to fix first.

## REVIEW_REPORT.md Format

```markdown
# PR Review Report — #<PR number>

| # | Category | Score | Comment |
|---|----------|-------|---------|
| 1 | style | 1 | ... |
| 2 | logic | 3 | ... |

To apply fixes, comment: `@agent fix #1 #3`
```

## Agent Fix Rules

- Never auto-fix without explicit dev approval
- Read git-os SKILL.md before making any commit
- One commit per fix item
- Commit format: `fix(scope): description\n\nResolves review comment #N`
- Push to the same PR branch

## Failure Handling

If a fix cannot be applied cleanly, post a comment explaining the conflict and wait for instruction. Never force-push or silently skip a fix.
