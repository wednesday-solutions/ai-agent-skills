# Implementation Plan — Phase 1 (Org Foundation)

> Built on top of: `@wednesday-solutions-eng/ai-agent-skills` (public repo, this codebase)
> The PRD references a separate private repo, but we're building Phase 1 features directly here, then can extract to private package later.

---

## Current State (What Already Exists)

| What | Where | Status |
|------|-------|--------|
| CLI entrypoint | `bin/cli.js` | Working — `install`, `configure`, `list` commands |
| Skill discovery + CLAUDE.md injection | `bin/cli.js` | Working |
| `wednesday-dev` skill | `skills/wednesday-dev/SKILL.md` | Active |
| `wednesday-design` skill | `skills/wednesday-design/SKILL.md` | Active |
| No dependencies | `package.json` | Pure Node.js — needs deps for 1C/1D |

---

## Phase 1A — GIT-OS Skill (Week 1)

**Goal:** Every agent in any repo follows conventional commits automatically.

### Tasks

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1 | Create `git-os` SKILL.md | `skills/git-os/SKILL.md` | Existing install mechanism picks it up automatically |
| 2 | Create commitlint config | `.commitlintrc.json` | Ships with the package, copied to target project on install |
| 3 | Create GitHub Action for commit-lint | `.github/workflows/commit-lint.yml` | Copied to target project on install |
| 4 | Add `git-os` install step in CLI | `bin/cli.js` — `install()` | Copy `.commitlintrc.json` + workflow file to target project |
| 5 | Update `listSkills()` | `bin/cli.js` | Add git-os to the list output |

### SKILL.md content
```
types: feat | fix | refactor | perf | docs | style | test | chore
format: type(scope?): Description
subject: imperative mood, <50 chars, no period, lowercase type
body: blank line after subject, 72 char wrap, explain WHY first
pre-push: lint → format:check → test → build (all must pass)
atomic: one logical change per commit — if unsure, split it
never: bundle concerns, force push target, rewrite shared history
no emoji, no "Co-Authored-By" in generated commits
```

### How to Test 1A
```bash
# 1. Run install in a test project
node bin/cli.js install /tmp/test-project

# 2. Check skill was copied
ls /tmp/test-project/.wednesday/skills/git-os/

# 3. Check CLAUDE.md was updated
cat /tmp/test-project/CLAUDE.md | grep git-os

# 4. In a real repo: make a bad commit → commit-lint CI should fail
# 5. Make a good commit → CI passes
```

### Deliverables
- `skills/git-os/SKILL.md`
- `.commitlintrc.json`
- `assets/workflows/commit-lint.yml` (template, copied on install)
- Updated `bin/cli.js` (copies workflow + commitlintrc on install)

---

## Phase 1B — Gemini PR Triage + Fix Loop (Week 2)

**Goal:** Gemini PR review comments auto-sorted + agent fixes on dev approval.

### Architecture Decision
The GitHub Action calls a small Node.js script bundled in this package. The script uses the Claude Haiku API (via OpenRouter or Anthropic direct) to categorize comments.

### Tasks

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1 | Create triage GitHub Action | `assets/workflows/triage.yml` | Triggers on `issue_comment` + `pull_request_review` |
| 2 | Create triage script | `scripts/triage.js` | Fetches PR comments, calls Haiku, posts report |
| 3 | Create triage SKILL.md | `skills/triage-loop/SKILL.md` | Documents the flow for agents |
| 4 | Handle `@agent fix #N` trigger | `scripts/triage.js` | Parses PR comment, applies fix, commits + pushes |
| 5 | Copy workflow + script on install | `bin/cli.js` | New `copyGitHubAssets()` helper |

### Environment Variables Required
```
GITHUB_TOKEN       — GitHub Action provides this automatically
ANTHROPIC_API_KEY  — Must be set as a repo secret (or OPENROUTER_API_KEY)
```

### Triage Script Flow
```
1. Parse GitHub webhook payload (comment body)
2. If Gemini bot comment → fetch all PR review comments via GitHub API
3. Call Haiku: categorize each comment with score 1–6
4. Sort ascending, generate REVIEW_REPORT.md markdown
5. Post report as PR comment via GitHub API
6. If comment matches "@agent fix #N" → apply fix, commit (GIT-OS format), push
```

### How to Test 1B
```bash
# Unit test the categorization logic
node scripts/triage.js --test

# Integration test: use act (local GitHub Actions runner)
act pull_request_review -e test/fixtures/gemini-review.json

# Manual test: post a PR comment "@agent fix #1" on a real PR
```

### Deliverables
- `skills/triage-loop/SKILL.md`
- `scripts/triage.js`
- `assets/workflows/triage.yml`
- `test/fixtures/gemini-review.json` (test fixture)

---

## Phase 1C — Terminal Dashboard (Week 3)

**Goal:** `wednesday-skills dashboard` shows PRs, triage queue, skills, and cost in one TUI.

### Tasks

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1 | Add Ink v4 + dependencies | `package.json` | `ink`, `react`, `@octokit/rest` |
| 2 | Create dashboard entry component | `src/dashboard/App.jsx` | Four panels layout |
| 3 | Create PR panel | `src/dashboard/PRPanel.jsx` | GitHub API → open PRs |
| 4 | Create triage queue panel | `src/dashboard/TriagePanel.jsx` | Reads from `.wednesday/cache/triage.json` |
| 5 | Create skills panel | `src/dashboard/SkillsPanel.jsx` | Reads from `.wednesday/skills/` |
| 6 | Create cost panel | `src/dashboard/CostPanel.jsx` | Reads `.wednesday/cache/usage.json` |
| 7 | Add `dashboard` command to CLI | `bin/cli.js` | `case 'dashboard': launchDashboard()` |
| 8 | Add `--pr` flag support | `bin/cli.js` | Focus mode for specific PR |

### Dependencies to Add
```json
{
  "ink": "^4.4.1",
  "react": "^18.2.0",
  "@octokit/rest": "^20.0.2",
  "node-fetch": "^3.3.2"
}
```

### Environment Variables Required
```
GITHUB_TOKEN       — for PR data
OPENROUTER_API_KEY — for cost data (optional, shows "no key" if missing)
```

### How to Test 1C
```bash
# Launch dashboard (needs GITHUB_TOKEN env var)
GITHUB_TOKEN=ghp_xxx wednesday-skills dashboard

# Test with no API key (should show graceful fallback)
wednesday-skills dashboard

# Test --pr flag
wednesday-skills dashboard --pr 142

# Test refresh (press r), quit (press q)
```

### Deliverables
- `src/dashboard/` — React/Ink components
- Updated `package.json` (new dependencies)
- Updated `bin/cli.js` (new `dashboard` command)

---

## Phase 1D — Greenfield Planning + Sprint/Deploy Skills (Week 4)

**Goal:** `wednesday-skills plan` produces `PLAN.md` via 3 parallel Haiku + 1 Sonnet.

### Tasks

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1 | Create greenfield planning script | `scripts/plan.js` | Reads BRIEF.md, runs 3 Haiku agents in parallel |
| 2 | Create Architect persona prompt | `scripts/plan.js` | Returns `{ systemDesign, techStack, moduleBoundaries, concerns[] }` |
| 3 | Create PM persona prompt | `scripts/plan.js` | Returns `{ requirements[], priorities[], outOfScope[], milestones[] }` |
| 4 | Create Security persona prompt | `scripts/plan.js` | Returns `{ threatSurface[], dataRisks[], authRecommendations[], flags[] }` |
| 5 | Create Sonnet synthesis call | `scripts/plan.js` | Combines 3 JSON outputs → PLAN.md |
| 6 | Create greenfield SKILL.md | `skills/greenfield/SKILL.md` | Documents the flow |
| 7 | Create sprint SKILL.md | `skills/sprint/SKILL.md` | Branch naming, PR title/desc template |
| 8 | Create deploy-checklist SKILL.md | `skills/deploy-checklist/SKILL.md` | Pre/post deploy steps |
| 9 | Create tools.json adapter layer | `src/adapters/` | ToolAdapter base + implementations |
| 10 | Add `plan` command to CLI | `bin/cli.js` | `case 'plan': runPlanning()` |
| 11 | Add `sync` command to CLI | `bin/cli.js` | `case 'sync': runSync(args)` |

### tools.json Adapter Layer
```
src/adapters/
├── index.js          — ToolAdapter interface + registry
├── claude-code.js    — writes XML block to CLAUDE.md
├── antigravity.js    — copies files to ~/.gemini/antigravity/skills/
└── gemini-cli.js     — writes XML block to GEMINI.md
```

### Environment Variables Required
```
ANTHROPIC_API_KEY  — for Haiku + Sonnet calls (or OPENROUTER_API_KEY)
```

### How to Test 1D
```bash
# Create a test brief
echo "Build a todo app with auth" > /tmp/test-project/BRIEF.md

# Run planning
cd /tmp/test-project && wednesday-skills plan

# Check output
cat PLAN.md
cat CODEBASE.md

# Test sync
wednesday-skills sync
wednesday-skills sync --tool antigravity

# Check cost stayed under $0.15 (logged in .wednesday/cache/usage.json)
cat .wednesday/cache/usage.json
```

### Deliverables
- `scripts/plan.js`
- `skills/greenfield/SKILL.md`
- `skills/sprint/SKILL.md`
- `skills/deploy-checklist/SKILL.md`
- `src/adapters/` (tools.json adapter layer)
- Updated `bin/cli.js` (`plan`, `sync` commands)
- Updated `package.json` (`files` array includes `src/`, `scripts/`, `assets/`)

---

## Build Order

```
1A (git-os skill + commit-lint)
  → 1B (triage loop — uses GIT-OS for agent commits)
    → 1C (dashboard — uses triage data)
      → 1D (greenfield + sprint + deploy + tools.json)
```

Each subphase is independently releasable. 1D is mostly independent of 1B/1C.

---

## What You Need Before Starting

### To start 1A immediately — nothing needed
- Pure file creation, zero external dependencies
- Test by running `node bin/cli.js install /tmp/test-project`

### To start 1B
- An Anthropic API key (or OpenRouter key) stored as `ANTHROPIC_API_KEY`
- A GitHub repo with Gemini bot enabled (for integration test)
- GitHub Actions enabled on the repo

### To start 1C
- `npm install` after adding Ink dependencies
- A `GITHUB_TOKEN` with `repo` scope

### To start 1D
- Anthropic API key (same as 1B)
- Cost: ~$0.14 per plan run — have a small budget ready

---

## Repository Structure After All 4 Subphases

```
ai-agent-skills/
├── bin/
│   └── cli.js                     # Updated: dashboard, plan, sync commands
├── scripts/
│   ├── triage.js                  # 1B: Gemini PR triage + fix loop
│   └── plan.js                    # 1D: Greenfield parallel planning
├── src/
│   ├── dashboard/                 # 1C: Ink TUI components
│   │   ├── App.jsx
│   │   ├── PRPanel.jsx
│   │   ├── TriagePanel.jsx
│   │   ├── SkillsPanel.jsx
│   │   └── CostPanel.jsx
│   └── adapters/                  # 1D: tools.json adapter layer
│       ├── index.js
│       ├── claude-code.js
│       ├── antigravity.js
│       └── gemini-cli.js
├── skills/
│   ├── wednesday-dev/             # Existing
│   ├── wednesday-design/          # Existing
│   ├── git-os/                    # 1A: NEW
│   ├── triage-loop/               # 1B: NEW
│   ├── greenfield/                # 1D: NEW
│   ├── sprint/                    # 1D: NEW
│   └── deploy-checklist/          # 1D: NEW
├── assets/
│   └── workflows/
│       ├── commit-lint.yml        # 1A: Copied to target on install
│       └── triage.yml             # 1B: Copied to target on install
├── test/
│   └── fixtures/
│       └── gemini-review.json     # 1B: Test fixture
├── .commitlintrc.json             # 1A: Template for target projects
└── package.json                   # Updated: ink, react, @octokit/rest deps
```

---

## Open Questions to Resolve Before 1B

1. **`@agent fix` trigger mechanism** — PR comment or GitHub Action `workflow_dispatch`? Recommendation: PR comment (simpler UX, no extra UI).
2. **Antigravity path** — macOS vs Linux? Need to test on both before 1D adapter.
3. **`BRIEF.md` — required file or interactive prompt?** Recommendation: required file (easier to automate, version-controllable).
4. **Private npm scope** — `@wednesday-solutions-eng` (already used) or new org? Use existing scope.
