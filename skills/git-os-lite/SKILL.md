---
name: git-os-lite
description: Use before making any commit or creating any branch. Enforces conventional commits and atomic commit rules.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
requires: []
conflicts:
  - git-os
  - git-os-commits
tags:
  - git
  - commits
  - workflow
permissions:
  allow:
    - Bash(git *)
---

# GIT-OS Lite

## When to use
- About to write a commit message
- About to create a branch
- Asked to commit or push anything

## What to do

### Commit format
```
type(scope?): Description
```

**Allowed types:** `feat` | `fix` | `refactor` | `perf` | `docs` | `style` | `test` | `chore`

**Subject rules:**
- Imperative mood — "Add feature" not "Added feature"
- Under 50 characters
- No period at the end

**Body rules (optional):**
- Blank line after subject
- Explain WHY, not what — the diff shows what
- Wrap at 72 characters

### Atomic commits
- One logical change per commit
- If a change touches more than one concern — split it
- If unsure whether to split: split it

### Branch format
```
type/short-description
```
Examples: `feat/oauth-login`, `fix/token-expiry`, `chore/update-deps`

## Examples

```
feat(auth): Add OAuth login flow
fix(api): Prevent null crash on empty token
refactor(db): Extract query builder to separate module
chore: Update dependencies to latest patch versions
```

## Never
- Use a type not in the allowed list
- Bundle multiple concerns in one commit
- Add Co-Authored-By or AI attribution lines
- Use emojis in commit messages
- Write "WIP" or "fix stuff" as a commit message
- Commit directly to main or master

## Conflict note

If `git-os` or `git-os-commits` is also installed, those take precedence — they are supersets of this skill. Remove `git-os-lite` when upgrading.
