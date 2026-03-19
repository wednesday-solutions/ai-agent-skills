# Wednesday Agent Skills — Roadmap

> Package: `@wednesday-solutions-eng/ai-agent-skills`
> CLI: `ws-skills` / `wednesday-skills`

---

## Phase 1 — Foundation ✅ SHIPPED

Core install, skill discovery, agent configuration, triage, dashboard, and greenfield planning.

| Feature | Status | Notes |
|---------|--------|-------|
| `ws-skills install` — copies skills + configures agents | ✅ | CLAUDE.md, GEMINI.md, .cursorrules, copilot-instructions.md |
| `ws-skills configure` — re-run agent config only | ✅ | |
| `ws-skills sync` — re-run tools.json adapters | ✅ | claude-code, gemini-cli, antigravity |
| `ws-skills list` — list available skills | ✅ | |
| `ws-skills plan` — greenfield parallel persona planning | ✅ | Research → [Architect\|PM\|Security] → Synthesis |
| `ws-skills dashboard` — Ink TUI for PRs + triage | ✅ | |
| `git-os` skill | ✅ | Conventional commits, pre-push checklist |
| `greenfield` skill | ✅ | Research agent + 3 parallel personas → PLAN.md |
| `sprint` skill | ✅ | Branch name, PR title, description from ticket |
| `deploy-checklist` skill | ✅ | Pre/post deploy verification |
| `wednesday-dev` skill | ✅ | Import ordering, complexity limits, naming |
| `wednesday-design` skill | ✅ | 492+ approved UI components, design tokens |
| `commit-lint.yml` CI | ✅ | Blocks non-conventional commits |
| `triage.yml` CI | ✅ | Triggers on Gemini review + `@agent fix` |
| `.env` loading — cwd → `~/.wednesday/.env` | ✅ | |
| tools.json adapter layer | ✅ | `src/adapters/` |
| Plan output → `.wednesday/plans/` | ✅ | research.md, architect.md, pm.md, security.md, PLAN.md |

---

## Phase 1.5 — PR Automation ✅ SHIPPED

PR creation, AI-generated body, unified review report, coverage and sonar as CI.

| Feature | Status | Notes |
|---------|--------|-------|
| `ws-skills pr` — validate, pre-push, push, create PR | ✅ | |
| AI-generated PR description + steps to test | ✅ | OpenRouter API; fallback to commit bullets if no key |
| Branch validation — soft warning, not hard stop | ✅ | |
| Stacked PR detection | ✅ | git merge-base + remote branch tip comparison |
| Ticket ID extraction from branch name | ✅ | `[A-Z]+-\d+` pattern |
| `pr-create` skill | ✅ | Agent-driven flow: validate → checklist → push → create |
| `pr-review` skill | ✅ | Gemini fix queue — categorised by impact, fixed on approval |
| Interactive install checklist | ✅ | Skills section + PR Scripts section (coverage, sonar) |
| `.wednesday/config.json` — saves install preferences | ✅ | `pr_scripts: { coverage, sonar }` |
| Auto-run coverage + sonar after `ws-skills pr` | ✅ | Reads config.json, posts reports under PR |
| `ws-skills coverage [base] [--post]` command | ✅ | Wraps pr-coverage.sh |
| `ws-skills sonar [base] [--post]` command | ✅ | Wraps pr-sonar.sh |
| `pr-coverage.yml` CI workflow | ✅ | Triggers on PR push, runs jest coverage, posts comment |
| `pr-sonar.yml` CI workflow | ✅ | Triggers on PR push, runs sonar-scanner, posts comment |
| Scripts copied to `.wednesday/scripts/` on install | ✅ | CI and terminal use same script |
| Triage report — 6A Gemini / 6B Coverage / 6C Sonar | ✅ | Single unified comment, updates on re-run |
| HTML markers for comment identification | ✅ | `<!-- wednesday-*-report -->` |
| Sonar script — dynamic `$REPO` (no hardcoding) | ✅ | |
| `triage.yml` — `workflow_run` trigger for coverage + sonar | ✅ | Unified report refreshes when either script posts |

**Required secrets for Phase 1.5 CI:**
```
OPENROUTER_API_KEY   — for triage categorisation + PR description (optional — graceful fallback)
SONAR_TOKEN          — for pr-sonar.yml
SONAR_HOST_URL       — for pr-sonar.yml
GITHUB_TOKEN         — provided automatically by GitHub Actions
```

---

## Phase 2 — Brownfield Intelligence 🔜 NEXT

Automatic codebase mapping, dependency analysis, and plain-English documentation for large client projects.

**Goal:** New dev productive on a client project within 2 hours of running `ws-skills analyze`.

### Phase 2A — Polyglot Parser + Dependency Graph (Weeks 1–2)

Zero LLM cost. tree-sitter workers parse the full codebase in parallel and build a JSON dep graph.

| Feature | Status | Notes |
|---------|--------|-------|
| tree-sitter core + language adapter interface | 🔜 | |
| TypeScript / JavaScript adapter | 🔜 | React, Next.js, Node, RN, Electron — barrel files + path aliases |
| Go adapter | 🔜 | go.mod, capitalised exports, replace directives |
| Kotlin / Java adapter | 🔜 | Gradle multi-module, version catalog |
| GraphQL adapter | 🔜 | Schema stitching, resolver→type mapping |
| Dep graph engine → `.wednesday/dep-graph.json` | 🔜 | nodes, edges, packages — all languages merged |
| Incremental cache — only changed files re-parsed | 🔜 | `.wednesday/cache/hashes.json` |
| `ws-skills analyze` CLI command | 🔜 | `--full`, `--lang`, `--watch` flags |

### Phase 2B — Static Analysis (Week 3)

Zero LLM cost. All six features run as graph algorithms.

| Feature | Status | Notes |
|---------|--------|-------|
| Blast radius analyzer | 🔜 | `ws-skills blast <file>` — ranked dependents |
| API surface mapper | 🔜 | Public contracts vs internal — `isPublicContract` per export |
| Dead code detector | 🔜 | Dead files + dead exports, sorted by size |
| Change safety scorer | 🔜 | 0–100 risk score per file — blocks agent fixes on score > 70 |
| Call graph tracer | 🔜 | `ws-skills trace <file> <fn>` — function-level TS/JS |
| Stale dep watchdog | 🔜 | Weekly GitHub Action → GitHub issue with upgrade list |

### Phase 2C — Haiku Summarisation (Week 4)

~$0.10 one-time on first scan. Cached per file hash — near zero ongoing cost.

| Feature | Status | Notes |
|---------|--------|-------|
| Module summarizer — 2-line summary per node | 🔜 | Cached in `.wednesday/cache/summaries/` |
| MASTER.md generator | 🔜 | `ws-skills summarize` — full codebase doc |
| Conflict explainer | 🔜 | Plain-English dep conflict + resolution order |
| Onboarding interview mode | 🔜 | `ws-skills onboard` — scoped guide per layer + task |

### Phase 2D — Sonnet Reasoning (Weeks 5–6)

Called sparingly (~$0.10–0.15 per call). Inputs are always graph + summaries, never raw source.

| Feature | Status | Notes |
|---------|--------|-------|
| Safe refactor planner | 🔜 | `ws-skills plan-refactor "..."` — GIT-OS ordered steps |
| Multi-module migration strategy | 🔜 | `ws-skills plan-migration "..."` — correct upgrade sequence |
| MASTER.md accuracy QA | 🔜 | Cross-checks generated doc against graph |
| `brownfield` skill | 🔜 | Tells agents to use graph + MASTER.md instead of raw source |

**Required for Phase 2:**
```
OPENROUTER_API_KEY   — module summarisation + reasoning (free tier first, then paid)
```

---

## CLI Command Reference

```bash
# Install & configure
ws-skills install                      # interactive checklist
ws-skills install --all                # install everything
ws-skills configure [agent]            # re-configure agents
ws-skills sync [--tool <name>]         # re-sync tools.json adapters

# PR workflow
ws-skills pr                           # validate → checklist → AI body → push → create PR
ws-skills pr --dry-run                 # preview without pushing
ws-skills coverage [base] [--post]     # run coverage, post to PR
ws-skills sonar [base] [--post]        # run sonar, post to PR

# Planning
ws-skills plan [--brief "..."]         # greenfield: Research + 3 personas → PLAN.md
ws-skills dashboard [--pr <n>]         # TUI: open PRs, triage queue, skills, cost

# Phase 2 (coming)
ws-skills analyze [--full|--watch]     # parse codebase → dep-graph.json
ws-skills blast <file>                 # blast radius
ws-skills score <file>                 # risk score
ws-skills dead                         # dead code
ws-skills summarize                    # generate MASTER.md
ws-skills onboard                      # onboarding interview
ws-skills plan-refactor "..."          # safe refactor plan
ws-skills plan-migration "..."         # migration strategy
```

---

## Directory Layout (current)

```
ai-agent-skills/
├── bin/cli.js                          # CLI entrypoint
├── scripts/
│   ├── triage.js                       # Gemini triage + unified report
│   ├── plan.js                         # Greenfield parallel planning
│   └── pr-create.js                    # Headless PR creation
├── src/
│   ├── dashboard/                      # Ink TUI
│   └── adapters/                       # tools.json adapter layer
├── skills/
│   ├── git-os/
│   ├── pr-create/
│   ├── pr-review/
│   ├── greenfield/
│   ├── sprint/
│   ├── deploy-checklist/
│   ├── wednesday-dev/
│   └── wednesday-design/
├── assets/
│   ├── workflows/
│   │   ├── commit-lint.yml
│   │   ├── triage.yml
│   │   ├── pr-coverage.yml             # NEW in 1.5
│   │   └── pr-sonar.yml                # NEW in 1.5
│   └── scripts/
│       ├── pr-coverage.sh
│       └── pr-sonar.sh
└── .wednesday/                         # installed into target projects as:
    ├── skills/                         #   .wednesday/skills/
    ├── scripts/                        #   .wednesday/scripts/
    ├── plans/                          #   .wednesday/plans/
    └── config.json                     #   .wednesday/config.json
```
