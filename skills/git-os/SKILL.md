---
name: git-os
description: Enforces conventional commits, atomic changes, and GIT-OS workflow for Wednesday Solutions projects. Every agent that generates a commit must read this skill first.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
---

# GIT-OS — Automation-First Git Workflow

My Git history powers automation. Commits drive version bumps, changelogs, release notes, deployments, and CI behavior. If commits are wrong → automation breaks.

## 1. Branching Model

| Branch | From | PR target | Purpose |
|--------|------|-----------|---------|
| `feat/<name>` | `<target>` | `<target>` | New feature |
| `fix/<name>` | `<target>` | `<target>` | Bug fix |
| `chore/<name>` | `<target>` | `<target>` | Tooling / config |
| `test/<name>` | `<target>` | `<target>` | Test additions |
| `hotfix/<name>` | `<target>` | `<target>` | Urgent prod fix |

`<target>` is project-specific (`main`, `develop`, etc.). Never commit directly to target. All changes enter via PR.

**Stacked PRs:** When PRs depend on each other, stack them bottom-up. `feat/b` branches from `feat/a`, targets `feat/a`. Merge order: a → b → c.

## 2. Commit Format

```
type(scope?): Description

(optional body)

(optional footer)
```

### Allowed types

`feat` | `fix` | `refactor` | `perf` | `docs` | `style` | `test` | `chore`

Do NOT invent types. Do NOT skip colon. Do NOT capitalize the type. Do NOT add emoji.

### Subject line rules

- Imperative mood: "Add login" not "Added login"
- Under 50 characters
- No trailing period
- Lowercase type, capitalized description

### Body rules (when needed)

- Blank line after subject
- Wrap at 72 characters
- Explain WHY first, then WHAT changed

### Breaking changes

```
refactor: Remove legacy user endpoint

BREAKING CHANGE: /v1/users removed. Use /v2/users
```

## 3. Atomic Commit Rule

One logical change per commit. If unsure → split it.

```
# Good
feat: Add login endpoint
test: Add login integration tests

# Bad
feat: Add login and fix navbar and update readme
```

## 4. Pre-Push Checklist

Before pushing any branch, all must pass:

1. `npm run lint`
2. `npm run format:check`
3. `npm run test`
4. `npm run build`

CI is a safety net, not the first line of defense.

## 5. Pull Request Rules

- Max 5–6 files per PR
- PR title follows the same conventional commit format
- Use this PR description template:

```
### Ticket Link
---
### Description
---
### Steps to Test
---
### GIFs
---
```

## 6. What Never To Do

- Commit without a type
- Bundle multiple concerns in one commit
- Force push the target branch
- Rewrite shared history
- Include AI attribution — no `Co-Authored-By` lines, no AI tool mentions

Commits should look human-authored. No fingerprints.

## 7. Agent Commit Format

When an agent generates a commit for a fix from a review comment:

```
fix(scope): description from review comment

Resolves review comment #N
```
