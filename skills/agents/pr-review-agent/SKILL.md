---
name: pr-review-agent
description: Full PR review orchestrator. Use when asked to review a PR or check if it is ready to merge. Runs blast radius + drift check on changed files, then hands off to pr-review for comment triage and fixes. Do NOT use pr-review directly for full reviews — use this.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
requires:
  - brownfield-fix
  - brownfield-drift
  - pr-review
permissions:
  allow:
    - Bash(git *)
    - Bash(gh *)
    - Bash(wednesday-skills drift *)
    - Bash(wednesday-skills blast *)
    - Bash(wednesday-skills score *)
---

# PR Review Agent

## When to use
- "Review this PR"
- "Is this PR ready to merge?"
- "Check this PR for issues"
- PR is open and review comments have been posted

## What to do

1. **triage-read** — Fetch all review comments via `gh pr view --comments`. Sort by impact: security → breaking → logic → performance → naming → style. Present the full categorised list to the dev.

2. **In parallel:**
   - **brownfield-fix** — Run `wednesday-skills score` and `wednesday-skills blast` on every file changed in the PR. Flag any file with risk > 60.
   - **brownfield-drift** — Run `wednesday-skills drift --since <base-sha>`. Report any architecture violations introduced by this PR.

3. Present a unified report:
   - Review comments (categorised)
   - High-risk changed files (score + dependent count)
   - Architecture violations (if any)

4. **triage-fix** — Wait for dev approval: "@agent fix #N" or "@agent fix all". Apply fixes in priority order. Read git-os skill before committing. One commit per fix item.

## Never
- Fix without explicit dev approval
- Skip blast radius check — always run even for small PRs
- Skip drift check — always run even if no violations are expected
- Bundle multiple file fixes in one commit
- Force-push or silently skip a failed fix
