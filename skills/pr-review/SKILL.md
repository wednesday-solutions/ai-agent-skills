---
name: pr-review
description: Unified PR review skill. Merges Gemini review comments, coverage report, and Sonar report into a single 6A/6B/6C checklist. Agent reads the report and fixes Gemini items in priority order. Coverage and Sonar are informational health sections.
license: MIT
metadata:
  author: wednesday-solutions
  version: "2.0"
---

# PR Review — Unified Report

## Flow

```
Gemini bot review posted
  OR coverage/sonar workflow completes
          ↓
Fetch: Gemini comments + coverage report + sonar report
          ↓
Merge into single priority queue
          ↓
Post REVIEW_REPORT as PR comment (update if already exists)
          ↓
Dev: "@agent fix #1 #3"
          ↓
Agent reads GIT-OS → applies fix → commits → pushes
```

## Unified Priority Order

Fix in this order — lower rank number = fix first.

| Rank | Priority Key | Source | Examples |
|------|-------------|--------|---------|
| 1 | sonar-blocker | SonarQube | null deref, resource leak |
| 2 | sonar-high | SonarQube | serious bugs, security hotspots |
| 3 | gemini-security | Gemini | auth issues, injection risks |
| 4 | gemini-breaking | Gemini | API contract changes |
| 5 | coverage-gap | Coverage | file below 80% statement coverage |
| 6 | sonar-medium | SonarQube | code smells, minor bugs |
| 7 | gemini-logic | Gemini | wrong conditions, edge cases |
| 7 | gemini-perf | Gemini | N+1, unnecessary re-renders |
| 8 | gemini-naming | Gemini | variable/function names |
| 8 | gemini-style | Gemini | formatting, import order |
| 9 | sonar-low | SonarQube | minor code smells |

**Rule: a Sonar BLOCKER is always fixed before any Gemini style item.**

## REVIEW_REPORT Format

```markdown
# PR Review Report — #<n>

## Priority Queue
| # | Priority | Source | File | Issue | Status |
|---|----------|--------|------|-------|--------|
| 1 | sonar-blocker | SonarQube | src/auth.js:12 | Null dereference | ⬜ pending |
| 2 | gemini-security | Gemini | src/db.js | SQL not parameterized | ⬜ pending |
...

## Coverage Summary
| File | Stmts | Branch | Funcs | Lines |
...

## Sonar Summary
| Severity | Count |
...

## How to Fix
In Claude Code / Antigravity: "fix items 1 and 2 from the triage report"
In terminal: wednesday-skills fix --pr <n> --items 1,2
```

## Reading the Report as an Agent

1. Always read the unified report first (look for `# PR Review Report` comment on the PR)
2. If no unified report exists yet, fall back to reading individual Gemini/coverage/sonar comments separately
3. When fixing, always work in rank order — never fix a style issue while a BLOCKER is pending
4. One commit per fix item, GIT-OS format: `fix(scope): description\n\nResolves triage item #N`

## Agent Fix Rules

- Never auto-fix without explicit dev approval (`@agent fix #N`)
- Read `git-os` SKILL.md before making any commit
- One commit per fix item
- Commit format: `fix(scope): description\n\nResolves triage item #N`
- Push to the same PR branch
- Update the report comment — mark fixed items as `✅ fixed`

## Failure Handling

If a fix cannot be applied cleanly, post a comment explaining the conflict. Never force-push or silently skip a fix.
