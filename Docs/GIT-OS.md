# GIT-OS — Automation-First Workflow

*For Conventional Commits + Semantic Release + GitHub Actions*

------------------------------------------------------------------------

## Mission

My Git history powers automation.

Commits drive:

- Version bumps
- Changelogs
- Release notes
- Deployments
- CI behavior

If commits are wrong → automation breaks.
If automation breaks → discipline failed.

------------------------------------------------------------------------

# 1. Branching Model

## Target Branch

The target branch (referred to as `<target>` below) is project-specific — it could be `main`, `develop`, or any integration branch defined by the project.

- Always stable
- Releases happen from here
- **Never commit directly**
- All changes enter via PR (requires review before merge)

## `feat/<name>`

- Branch from `<target>` (or from the previous feature branch if stacking)
- PR back into `<target>` (or into the previous feature branch if stacking)
- One feature per branch
- Max 5–6 files per PR

## `fix/<name>`

- Branch from `<target>`
- PR back into `<target>`
- Bug fixes and corrections

## `chore/<name>`

- Branch from `<target>`
- PR back into `<target>`
- Tooling, config, and cleanup

## `test/<name>`

- Branch from `<target>`
- PR back into `<target>`
- Test additions or updates

## `hotfix/<name>`

- Branch from `<target>`
- PR back into `<target>`
- Urgent production fixes

**Core rule:**\
Branches are temporary.
History is permanent.
Always branch from the latest `<target>` (or the tip of the previous feature when stacking).

------------------------------------------------------------------------

# 2. Workflow

## Independent Flow (single feature)

1. Pull latest `<target>`
2. Create feature branch: `git checkout -b feat/<name>`
3. Make atomic commits following Conventional Commits
4. Push branch, open PR → `<target>`
5. Review, approve, merge

## Stacked Flow (dependent features)

When PRs depend on each other and await review, stack them:

1. `feat/a` branches from `<target>` → PR targets `<target>`
2. `feat/b` branches from `feat/a` → PR targets `feat/a`
3. `feat/c` branches from `feat/b` → PR targets `feat/b`
4. Merge PRs **bottom-up** (a → b → c)

Each PR shows only its own diff against the previous branch.
After merging `feat/a` into `<target>`, update `feat/b` to target `<target>`, and so on.

**Independent PRs go directly to `<target>`.**\
**Dependent PRs stack on each other — only the bottom PR points at `<target>`.**

## Rules

- **Always branch from the latest available base** (`<target>` or previous feature tip)
- **One feature per branch** — keep PRs focused
- **No direct commits to `<target>`** — all changes go through PR
- **PRs require review** before merging to `<target>`

------------------------------------------------------------------------

# 3. Commit Format (Strict)

We follow **Conventional Commits** exactly.

```
type(scope?): Description

(optional body)

(optional footer)
```

## Allowed Types

- `feat:` → new feature
- `fix:` → bug fix
- `refactor:` → internal code change
- `perf:` → performance improvement
- `docs:` → documentation
- `style:` → formatting only
- `test:` → tests
- `chore:` → tooling/config

## Rules

- Do NOT invent types
- Do NOT skip colon
- Do NOT capitalize the type
- Do NOT add emojis

Correct:

```
feat: Add login validation
fix(auth): Prevent token crash
```

Wrong:

```
Feature: login
added login
feat(login)
feat - login
```

------------------------------------------------------------------------

# 4. Subject Line Rules

- Imperative mood
- Clear and specific
- No period
- Under ~50 characters
- Lowercase type, capitalized description

Example:

```
feat: Add password reset flow
```

------------------------------------------------------------------------

# 5. Body Rules (When Needed)

Use body when:

- Logic is complex
- Context matters
- Behavior changes
- Explaining WHY

Rules:

- Blank line after subject
- Wrap at ~72 characters
- Explain WHY first
- Then WHAT changed
- Avoid unnecessary detail

Example:

```
fix: Prevent crash when token expires

The API returned undefined when session expired.
Add guard clause to avoid null access.
```

------------------------------------------------------------------------

# 6. Breaking Changes

If backward compatibility changes:

```
BREAKING CHANGE: explanation
```

Example:

```
refactor: Remove legacy user endpoint

BREAKING CHANGE: /v1/users removed. Use /v2/users
```

------------------------------------------------------------------------

# 7. Pull Requests

## Rules

- Max 5–6 files per PR
- PRs require review before merge to `<target>`
- Merge stacked PRs bottom-up
- PR title follows the same conventional commit format

## PR Description Template

```
### Ticket Link
---------------------------------------------------

### Related Links
---------------------------------------------------

### Description
---------------------------------------------------

### Steps to Reproduce / Test
---------------------------------------------------

### GIF's
---------------------------------------------------
```

------------------------------------------------------------------------

# 8. Automation Awareness

Every commit triggers:

- GitHub Actions CI
- Linting
- Tests
- Semantic version calculation
- Changelog generation
- Possible deployment

Each commit must be:

- Intentional
- Atomic
- Correctly typed
- Meaningful

Do not commit noise.

------------------------------------------------------------------------

# 9. Atomic Commit Rule

One logical change per commit.

Good:

```
feat: Add login endpoint
test: Add login integration tests
```

Bad:

```
feat: Add login and fix navbar and update readme
```

Atomic commits make:

- Releases predictable
- Reverts safe
- Changelog clean

------------------------------------------------------------------------

# 10. Pre-Commit Checklist

Before commit:

1. Is the type correct?
2. Does it match what changed?
3. Is this one logical change?
4. Will Semantic Release understand it?
5. Should this be split into multiple commits?

If unsure → split it.

------------------------------------------------------------------------

# 11. Pre-Push Verification

Before pushing any branch, run these checks locally:

1. **Lint check:** `npm run lint`
2. **Format check:** `npm run format:check`
3. **Unit & Integration tests:** `npm run test`
4. **Build:** `npm run build`

All must pass before pushing. Do not rely on CI to catch what you
can catch locally. CI is a safety net, not the first line of defense.

This mirrors the GitHub Actions Check workflow. If it fails locally,
it will fail in CI. Fix before pushing.

------------------------------------------------------------------------

# 12. What Not To Do

Never:

- Commit without a type
- Use random prefixes
- Bundle multiple concerns
- Push broken tests
- Force push the target branch
- Rewrite shared history
- Include AI attribution (no `Co-Authored-By` lines, no AI tool mentions)

Commits should look human-authored. No fingerprints.

Automation depends on consistency.

------------------------------------------------------------------------

# 13. Clean History Principle

Your Git log should read like:

```
feat: Add OAuth login
fix(auth): Prevent refresh token race condition
refactor(api): Simplify user validation
test: Add coverage for login edge cases
```

If it looks messy → clean before pushing.

Git is communication.
Automation is the reader.

------------------------------------------------------------------------

# Final Rule

Commits are not notes.
Commits are instructions to automation.

Type correctly.
Structure correctly.
Keep them atomic.
Let CI + Semantic Release do the rest.

------------------------------------------------------------------------

End of GIT-OS