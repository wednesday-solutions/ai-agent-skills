# PRD — Wednesday AI Agent Skills: Phase 1 (Org Foundation)

| Field | Detail |
|-------|--------|
| Product | wednesday-solutions/ai-agent-skills-internal |
| Phase | 1 — Org Foundation |
| Timeline | 4 weeks |
| Audience | Internal Wednesday Solutions developers |
| Tools | Claude Code, Antigravity |
| Repo type | Private npm package |
| Version | v1.0 |

---

## 1. Executive Summary

| Field | Content |
|-------|---------|
| Product name | ai-agent-skills-internal (Phase 1) |
| One-liner | AI skill system that enforces git discipline, automates PR triage, and plans greenfield projects |
| Target user | Wednesday Solutions developers using Claude Code and Antigravity |
| Core problem | Inconsistent commits, manual Gemini PR review resolution, no structured greenfield planning |
| Solution | Four org-only skills installed via CLI — GIT-OS, PR triage loop, terminal dashboard, greenfield planner |
| Success metric | 80% of PRs merged with zero conventional commit violations by end of week 4 |

---

## 2. Problem Deep-Dive

**Current state**

- Commit messages are inconsistent — breaks semantic-release, changelogs, and CI automation
- Gemini bot posts PR review comments but devs manually parse, prioritize, and fix them — hours wasted per PR
- No structured greenfield planning — senior devs re-derive architecture decisions from scratch on each project
- No visibility into skill usage, PR status, or AI model costs without switching between tools

**Desired state**

- FROM: Developers write ad-hoc commit messages that break automation
  TO: Every commit is atomic, typed, and semantic-release compatible by default

- FROM: Devs spend 1–2 hours manually triaging Gemini bot comments
  TO: Triage report auto-generated, sorted by least codebase impact, agent fixes on approval

- FROM: Greenfield planning is unstructured and inconsistent across projects
  TO: Three AI personas produce a `PLAN.md` in minutes, surfacing architectural tensions early

- FROM: No single place to see PR status, costs, and installed skills
  TO: `wednesday-skills dashboard` shows everything in one terminal view

**Why now**

The `ai-agent-skills` public repo already exists and proved the SKILL.md install pattern works. Claude Code and Antigravity adoption is high internally. Gemini bot is already posting PR comments but has no downstream automation. GIT-OS conventions already documented — just needs to be an enforced skill.

---

## 3. Target Users

**Primary persona — Wednesday developer**
```
Role: Full-stack developer at Wednesday Solutions
Tools: Claude Code (primary), Antigravity (secondary)
Projects: Brownfield + greenfield client projects
Pain: Context-switching between Gemini bot, GitHub, and IDE to resolve PR issues
Quote: "I spend more time figuring out what to fix than actually fixing it"
```

**Anti-personas**
- External contributors (org skills are private, not for community)
- Clients (this is a developer-facing internal tool)

---

## 4. Phase 1 Subphases

### 1A — GIT-OS Skill (Week 1)
### 1B — Gemini PR Triage + Fix Loop (Week 2)
### 1C — Terminal Dashboard (Week 3)
### 1D — Greenfield Planning + Sprint/Deploy Skills (Week 4)

---

## 5. Feature Specifications

---

### Feature 1: GIT-OS Skill (1A)

| Attribute | Detail |
|-----------|--------|
| Priority | 🔴 Must-have |
| Phase | 1A — Week 1 |
| User value | Every agent and dev follows the same commit standard automatically |

**User story**
> As a Wednesday developer, I want AI agents to enforce conventional commits so that semantic-release and changelogs never break.

**Acceptance criteria**
- [ ] `SKILL.md` exists at `.wednesday/skills/git-os/SKILL.md` after install
- [ ] Skill injected into `CLAUDE.md` and `GEMINI.md` via `available_skills` XML block
- [ ] Commit-lint GitHub Action fails PRs with non-conventional commits
- [ ] Skill covers: allowed types, subject line rules, body rules, breaking changes, atomic commit rule, pre-push checklist
- [ ] Any agent in the repo that generates a commit reads GIT-OS before doing so
- [ ] No emoji, no AI attribution (`Co-Authored-By`) in generated commits

**Skill content (enforced rules)**

```
Types: feat | fix | refactor | perf | docs | style | test | chore
Format: type(scope?): Description
Subject: imperative mood, <50 chars, no period, lowercase type
Body: blank line after subject, 72 char wrap, explain WHY first
Pre-push: lint → format:check → test → build (all must pass)
Atomic: one logical change per commit — if unsure, split it
Never: bundle concerns, force push target, rewrite shared history
```

**GitHub Action — commit-lint**

```yaml
# .github/workflows/commit-lint.yml
on: [pull_request]
jobs:
  commitlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: wagoid/commitlint-github-action@v5
        with:
          configFile: .commitlintrc.json
```

**Outputs**

| State | Result |
|-------|--------|
| Valid commit | CI passes |
| Invalid commit | CI fails with specific rule violation message |
| Agent-generated commit | Follows GIT-OS, no fingerprints |

---

### Feature 2: Gemini PR Triage + Dev-Approved Fix Loop (1B)

| Attribute | Detail |
|-----------|--------|
| Priority | 🔴 Must-have |
| Phase | 1B — Week 2 |
| User value | Gemini review comments sorted and fixed in minutes, not hours |

**User story**
> As a developer, I want Gemini's PR review comments automatically triaged and fixed on my approval so that I don't manually parse bot output.

**Acceptance criteria**
- [ ] GitHub Action triggers on Gemini bot comment posted to any PR
- [ ] All bot comments fetched via GitHub API, parsed, and categorized
- [ ] Comments sorted: least codebase impact first (style → logic → breaking → security)
- [ ] `REVIEW_REPORT.md` posted as a PR comment with sorted list
- [ ] Dev approves specific fixes via PR comment command (e.g. `@agent fix #1 #3`)
- [ ] Agent makes the fix, commits using GIT-OS format, pushes to same PR branch
- [ ] No auto-fix without dev approval — human always in the loop

**Priority sort rubric**

| Category | Impact score | Examples |
|----------|-------------|---------|
| Style / lint | 1 — lowest | formatting, import order |
| Naming | 2 | variable names, casing |
| Logic | 3 | incorrect conditions, edge cases |
| Performance | 4 | unnecessary re-renders, N+1 queries |
| Breaking change | 5 | API contract changes |
| Security | 6 — highest | auth issues, injection risks |

**Sort direction: ascending by score** (least impact first = safest to fix first)

**Flow**

```
Gemini bot posts review comment
        ↓
GitHub Action webhook fires
        ↓
Fetch all bot comments (GitHub API)
        ↓
Haiku: categorize + score each comment
        ↓
Generate REVIEW_REPORT.md (sorted ascending)
        ↓
Post report as PR comment
        ↓
Dev reviews → comments "@agent fix #1 #3"
        ↓
Agent reads GIT-OS → applies fix → commits
  e.g. "fix(auth): remove unused token check"
        ↓
Push to same PR branch
```

**GitHub Action trigger**

```yaml
on:
  issue_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
```

**Agent commit format for fixes**

```
fix(scope): [description from Gemini comment]

Resolves Gemini review comment #N
```

**Outputs**

| State | User sees |
|-------|-----------|
| Triage complete | `REVIEW_REPORT.md` posted in PR thread |
| Fix approved | Agent commits + pushes, comment updated |
| Fix fails | Agent posts failure reason, awaits instruction |

**Model: Haiku** (comment categorization is structured JSON — cheap and fast)

---

### Feature 3: Terminal Dashboard (1C)

| Attribute | Detail |
|-----------|--------|
| Priority | 🔴 Must-have |
| Phase | 1C — Week 3 |
| User value | Single terminal view for PR status, triage queue, skills, and cost |

**User story**
> As a developer, I want a minimal terminal dashboard so that I don't context-switch between GitHub, the CLI, and my IDE to get status.

**Acceptance criteria**
- [ ] `wednesday-skills dashboard` launches Ink TUI
- [ ] Refreshes every 30 seconds or on keypress `r`
- [ ] Quit on `q`
- [ ] Four panels visible simultaneously — no tabs, no hidden sections
- [ ] Works in any terminal that supports Node (zsh, bash, fish)
- [ ] No colors that break on light terminals — uses system theme

**Four panels (minimal layout)**

```
┌─ Active PRs ──────────────────┐  ┌─ Triage queue ─────────────────┐
│ #142 feat: add auth   2 fixes │  │ #142 fix style (2) logic (1)   │
│ #139 fix: token crash 0 fixes │  │ #139 clear                     │
└───────────────────────────────┘  └────────────────────────────────┘

┌─ Skills installed ────────────┐  ┌─ OpenRouter usage ─────────────┐
│ git-os          v1.0  active  │  │ Today     $0.02   14 calls     │
│ triage-loop     v1.0  active  │  │ This week $0.11   82 calls     │
│ greenfield      v1.0  active  │  │ Model     haiku / free tier    │
└───────────────────────────────┘  └────────────────────────────────┘
```

**Tech stack**
- Ink v4 (React for CLI) — already fits in the `wednesday-skills` npm package
- GitHub API — PR and comment data
- OpenRouter API — usage and cost data
- Local `.wednesday/cache/usage.json` — persisted between sessions

**Commands**

```bash
wednesday-skills dashboard          # launch
wednesday-skills dashboard --pr 142 # focus on specific PR
```

**Outputs**

| State | Behavior |
|-------|----------|
| No PRs | Panel shows "no open PRs" |
| API rate limit | Cached data shown with stale indicator |
| No OpenRouter key | Cost panel shows "no key configured" |

---

### Feature 4: Greenfield Planning Skill — Parallel Persona Agents (1D)

| Attribute | Detail |
|-----------|--------|
| Priority | 🔴 Must-have |
| Phase | 1D — Week 4 |
| User value | Consistent, multi-perspective project planning in minutes |

**User story**
> As a developer starting a new project, I want three AI personas to analyze the brief in parallel so that I get an architecture plan with tensions surfaced before writing any code.

**Acceptance criteria**
- [ ] Triggered once per project: `wednesday-skills plan`
- [ ] Reads project brief from `BRIEF.md` in project root (or prompts for one)
- [ ] Three Haiku agents run in parallel — Architect, PM, Security
- [ ] Each agent outputs structured JSON (not prose)
- [ ] Single Sonnet call synthesizes all three into `PLAN.md`
- [ ] `PLAN.md` includes a `## Tensions` section for unresolved disagreements
- [ ] `CODEBASE.md` seeded with initial structure from Architect output
- [ ] Branch naming conventions in `PLAN.md` follow GIT-OS
- [ ] Total cost per run: under $0.15

**Parallel agent prompts (structured JSON output)**

```
Architect agent:
  Input: BRIEF.md
  Output: { systemDesign, techStack, moduleBoundaries, concerns[] }

PM agent:
  Input: BRIEF.md
  Output: { requirements[], priorities[], outOfScope[], milestones[] }

Security agent:
  Input: BRIEF.md
  Output: { threatSurface[], dataRisks[], authRecommendations[], flags[] }
```

**Synthesis (Sonnet)**

```
Input: three JSON objects above
Output: PLAN.md with sections:
  - Overview
  - Architecture
  - Requirements (prioritized)
  - Security considerations
  - Milestones
  - Tensions (unresolved conflicts between personas)
  - Branch naming (GIT-OS format)
```

**Cost breakdown per run**

| Call | Model | Est. cost |
|------|-------|-----------|
| Architect agent | Haiku | ~$0.02 |
| PM agent | Haiku | ~$0.02 |
| Security agent | Haiku | ~$0.02 |
| Sonnet synthesis | Sonnet | ~$0.08 |
| Total | — | ~$0.14 |

**PLAN.md structure**

```markdown
# Project plan — [name]

## Overview
## Architecture
## Requirements
## Security considerations
## Milestones
## Tensions
  - Architect: microservices vs PM: ship monolith first → decision needed
## Branch naming (GIT-OS)
  - feat/<name> from main
  - fix/<name> from main
```

**Additional 1D deliverables**

**Sprint initiation skill**
- Reads ticket title/description
- Outputs: branch name (GIT-OS format), PR title, PR description template (ticket link, steps, GIFs section)

**Deploy checklist skill**
- Pre-deploy: env vars checked, migrations run, rollback plan confirmed, CI green
- Post-deploy: smoke test, monitoring alert check, changelog updated

**Tool-agnostic config layer**
- `.wednesday/tools.json` defines per-tool adapter (format + config file path)
- `wednesday-skills sync` re-runs all adapters
- Adding a new tool = one entry in `tools.json`, zero code change

```json
{
  "tools": [
    { "name": "claude-code",  "config": "CLAUDE.md",               "format": "xml-block" },
    { "name": "antigravity",  "config": "~/.gemini/antigravity/skills/", "format": "file-copy" },
    { "name": "gemini-cli",   "config": "GEMINI.md",               "format": "xml-block" }
  ]
}
```

---

## 6. Installation Architecture

**Two repos, clean separation**

```
wednesday-solutions/ai-agent-skills          # public npm package (existing)
wednesday-solutions/ai-agent-skills-internal # private npm package (Phase 1)
```

**Install commands**

```bash
# Install org skills (internal devs only)
npx @wednesday-solutions-eng/ai-agent-skills-internal install

# Update after skill changes
wednesday-skills sync

# Sync for specific tool only
wednesday-skills sync --tool antigravity

# Launch dashboard
wednesday-skills dashboard

# Kickoff greenfield planning
wednesday-skills plan
```

**What install does**
1. Copies skill files to `.wednesday/skills/`
2. Reads `.wednesday/tools.json`
3. Runs adapter per tool — injects `available_skills` XML block or copies files
4. Writes `CLAUDE.md`, `GEMINI.md`, and Antigravity skill directory

**Directory structure after install**

```
project/
├── CLAUDE.md                        # Claude Code config (available_skills injected)
├── GEMINI.md                        # Gemini CLI config
├── .wednesday/
│   ├── tools.json                   # tool adapter config
│   ├── cache/
│   │   └── usage.json               # OpenRouter usage cache
│   └── skills/
│       ├── git-os/
│       │   └── SKILL.md
│       ├── triage-loop/
│       │   └── SKILL.md
│       ├── greenfield/
│       │   └── SKILL.md
│       ├── sprint/
│       │   └── SKILL.md
│       └── deploy-checklist/
│           └── SKILL.md
└── .github/
    └── workflows/
        ├── commit-lint.yml
        └── triage.yml
```

---

## 7. Technical Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Skill format | SKILL.md (agentskills spec) | Already supported by Claude Code + Antigravity |
| CLI framework | Node.js + existing bin/ | Already in the public repo |
| TUI | Ink v4 | React for CLI, fits Node stack |
| Triage model | Claude Haiku | Cheap, fast, structured JSON output |
| Synthesis model | Claude Sonnet | Complex reasoning, one-time calls |
| Free tier testing | OpenRouter | Free models for development/testing |
| PR integration | GitHub API (REST) | Fetch comments, post reports, trigger on webhooks |
| CI | GitHub Actions | Commit-lint, triage webhook |
| Config | .wednesday/tools.json | Evolvable tool adapter layer |

---

## 8. Scope

**In scope — Phase 1**
- GIT-OS SKILL.md + commit-lint action
- Gemini triage GitHub Action + Haiku categorization + REVIEW_REPORT
- Dev-approval fix loop + GIT-OS compliant commits to same PR branch
- Ink TUI dashboard (4 panels)
- Greenfield parallel persona planning (3 Haiku + 1 Sonnet)
- Sprint initiation skill
- Deploy checklist skill
- tools.json adapter layer + `sync` command

**Explicitly out of scope — Phase 1**
- Brownfield codebase analysis (Phase 2)
- Public skill registry (Phase 3)
- Agentic skill library / model router (Phase 3)
- Android / Kotlin support (Phase 2)
- Any web UI or browser dashboard

---

## 9. Success Metrics

| Metric | Target | Measured by |
|--------|--------|-------------|
| Commit violation rate | < 20% of PRs by week 4 | commit-lint CI failures |
| Triage time per PR | < 10 min (down from ~90 min) | Dev self-report |
| Greenfield plan quality | Senior dev sign-off on PLAN.md | Manual review |
| Dashboard adoption | Used daily by > 80% of devs | usage.json telemetry |
| Cost per PR triage | < $0.05 | OpenRouter usage log |
| Cost per greenfield plan | < $0.15 | OpenRouter usage log |

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GitHub API rate limits on triage | M | M | Cache responses, batch requests |
| Haiku misclassifies comment severity | M | M | Rubric in prompt, dev always approves |
| Ink TUI breaks on some terminals | L | L | Fallback to plain text output flag |
| Sonnet synthesis cost spikes | L | M | Token limit on each persona JSON output |
| Antigravity file-copy path varies per OS | M | M | Detect OS in tools.json adapter |
| Dev skips GIT-OS on manual commits | H | H | commit-lint CI hard blocks merge |

---

## 11. Open Questions

1. Should `@agent fix` command be a PR comment or a GitHub Action input dispatch?
2. Does Antigravity's skills directory path differ between macOS and Linux setups internally?
3. Should `BRIEF.md` be a required file or should `wednesday-skills plan` prompt interactively?
4. Private npm — scoped to Wednesday org on npm, or distributed via direct repo clone?

---

## 12. Build Order (strict dependency chain)

```
1A (GIT-OS) → 1B (triage) → 1C (dashboard) → 1D (greenfield + sprint + deploy + tools.json)
```

1A must ship first — every other feature that generates commits depends on it.
1B depends on GitHub Actions infra validated in 1A.
1C depends on triage data existing from 1B.
1D is independent of 1B/1C but requires 1A for commit formatting.