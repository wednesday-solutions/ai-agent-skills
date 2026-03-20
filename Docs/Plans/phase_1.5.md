# Phase 1.5 — Build prompt

You are working on `wednesday-solutions/ai-agent-skills-internal`, a private npm package that installs org skills for Claude Code and Antigravity. Phase 1 is already shipped. You are now implementing Phase 1.5 — a patch phase with three deliverables.

Read `.wednesday/skills/git-os/SKILL.md` before making any commits.

---

## Deliverable 1 — Agent-driven PR creation

Add a `pr` command to the `wednesday-skills` CLI and a corresponding skill.

The skill lives at `.wednesday/skills/pr-create/SKILL.md`. When a dev says "create PR" or "open PR" inside Claude Code or Antigravity, the agent:

1. Reads GIT-OS skill
2. Validates branch name matches `feat|fix|chore|test|hotfix/<name>` — if not, explain the correct format and stop
3. Runs pre-push checklist in order: `npm run lint` → `npm run format:check` → `npm run test` → `npm run build` — if any fail, stop and show the error
4. Extracts ticket ID from branch name if present (e.g. `feat/WED-142-oauth` → `WED-142`)
5. Generates PR title from the first commit message on the branch
6. Detects if current branch was branched from another feature branch (stacked flow) — if so sets `--base` to that branch not main, adds a stacked note in the PR body
7. Generates PR body using GIT-OS template:
   - Ticket link (Linear URL if ticket ID found, blank otherwise)
   - Description built from commit messages on the branch
   - Steps to reproduce (dev fills in — leave placeholder)
   - GIFs section (leave blank)
8. Runs: `git push origin <branch>` then `gh pr create --title "..." --base <base> --body "..."`
9. Returns the PR URL

Terminal fallback: `wednesday-skills pr` — runs the same flow headlessly.

---

## Deliverable 2 — Unified triage report

Currently coverage, sonar, and Gemini triage post three separate PR comments. Merge them into one `REVIEW_REPORT.md` comment with a single priority queue.

**Priority order (highest to lowest):**
1. Sonar BLOCKER
2. Sonar HIGH
3. Gemini score 5–6 (security, breaking)
4. Gemini score 3–4 (logic, performance)
5. Coverage gap — any changed file below 80% statement coverage
6. Sonar MEDIUM
7. Gemini score 1–2 (style, naming)
8. Sonar LOW

**REVIEW_REPORT.md format:**

```
# PR review report — #<n>

## Priority queue
| # | Priority | Source | File | Issue | Status |
|---|----------|--------|------|-------|--------|
| 1 | Sonar BLOCKER | SonarQube | file:line | message | ⬜ pending |
...

## Coverage summary
| File | Stmts | Branch | Funcs | Lines |
...

## Sonar summary
| Severity | Count |
...

## How to fix
In Claude Code / Antigravity: "fix items 1 and 2 from the triage report"
In terminal: wednesday-skills fix --pr <n> --items 1,2
```

Update `triage.yml` so the unified report job runs after both `PR coverage report` and `PR sonar report` workflows complete:

```yaml
on:
  workflow_run:
    workflows: ["PR coverage report", "PR sonar report"]
    types: [completed]
  pull_request_review:
    types: [submitted]
```

Update `.wednesday/skills/triage-loop/SKILL.md` — agent now reads the unified report first, falls back to individual comments if unified report not yet generated. Fix priority includes sonar items — a BLOCKER is always fixed before any Gemini style item.

---

## Deliverable 3 — Sonar script fix

In `.wednesday/scripts/pr-sonar.sh` find the two occurrences of `{owner}/{repo}` and replace with the dynamic pattern the coverage script already uses:

```bash
REPO=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
```

Then replace `{owner}/{repo}` with `$REPO` in the `gh api` calls.

---

## Commit format for all changes

Follow GIT-OS strictly. Suggested commits:

```
feat(cli): add wednesday-skills pr command
feat(skills): add pr-create SKILL.md
feat(triage): merge coverage and sonar into unified REVIEW_REPORT
fix(sonar): replace hardcoded repo placeholder with GITHUB_REPOSITORY
feat(workflows): add workflow_run trigger to triage.yml
docs(skills): update triage-loop SKILL.md for unified report
```

One logical change per commit. Run pre-push checklist before pushing.