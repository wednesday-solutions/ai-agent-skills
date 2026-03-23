# Wednesday Agent Skills

AI skills for Wednesday Solutions projects — git discipline, PR automation, terminal dashboard, greenfield planning, and brownfield codebase intelligence with real-time chat, drift detection, and test generation.

---

## Install

**Option 1 — npx (no setup)**
```bash
npx @wednesday-solutions-eng/ai-agent-skills install
```

**Option 2 — global**
```bash
npm install -g @wednesday-solutions-eng/ai-agent-skills
wednesday-skills install
```

**Option 3 — shell (no npm)**
```bash
bash install.sh
```

Run in your project root. Done in seconds.

---

## What you get after install

| Feature | What it does |
|---------|-------------|
| `git-os` skill | Every agent follows conventional commits — no bad commit messages |
| `commit-lint` CI | GitHub Action blocks PRs with non-conventional commits |
| `pr-review` skill | Gemini fix queue — categorized by impact, fixed on dev approval |
| `triage` CI | GitHub Action that runs triage when Gemini bot posts a review |
| `greenfield` skill | Run `wednesday-skills plan` — 3 AI personas produce `PLAN.md` in minutes |
| `sprint` skill | Give a ticket → get branch name, PR title, and description template |
| `deploy-checklist` skill | Pre and post deploy verification checklist |
| `wednesday-dev` skill | Import ordering, complexity limits (max 8), naming conventions |
| `wednesday-design` skill | 492+ approved UI components, design tokens, animation patterns |
| `brownfield-query` skill | Answer structural questions from dep graph — never guesses |
| `brownfield-fix` skill | Risk check + blast radius before editing any file |
| `brownfield-gaps` skill | Fill dynamic coverage gaps via targeted Haiku subagents |
| `brownfield-chat` skill | Plain-English questions answered from the graph — zero LLM for most queries |
| `brownfield-drift` skill | Architecture drift detection against PLAN.md constraints |

**Config files written automatically:**
- `CLAUDE.md` — Claude Code
- `GEMINI.md` — Gemini CLI
- `.cursorrules` — Cursor
- `.github/copilot-instructions.md` — GitHub Copilot
- `.wednesday/tools.json` — tool adapter config (sync target for Antigravity)

---

## CLI commands

```bash
# Install + configure
wednesday-skills install                  # install + configure all agents
wednesday-skills install --skip-config    # install skills only
wednesday-skills configure . gemini       # re-configure a specific agent
wednesday-skills sync                     # re-sync all tool adapters
wednesday-skills sync --tool antigravity  # sync to Antigravity only

# Dashboard + planning
wednesday-skills dashboard                # launch terminal dashboard
wednesday-skills dashboard --pr 142       # focus dashboard on one PR
wednesday-skills plan                     # run greenfield planning

# Brownfield intelligence
wednesday-skills analyze                  # build/update dependency graph
wednesday-skills analyze --incremental    # only re-parse changed files (< 1s)
wednesday-skills analyze --full           # force full re-parse
wednesday-skills analyze --watch          # watch mode for development
wednesday-skills summarize                # generate summaries.json + MASTER.md
wednesday-skills fill-gaps --file <f>     # run subagents on coverage gaps
wednesday-skills blast <file>             # blast radius — what breaks if you change this
wednesday-skills score <file>             # risk score 0–100
wednesday-skills dead                     # list dead files and unused exports
wednesday-skills legacy                   # god files, circular deps, tech debt map
wednesday-skills trace <file>             # call chain from a file
wednesday-skills plan-refactor "goal"     # AI refactor plan (Sonnet)
wednesday-skills plan-migration "goal"    # AI migration strategy (Sonnet)
wednesday-skills onboard                  # interactive onboarding guide

# Phase 3 — Intelligence layer
wednesday-skills chat "what does tokenService do"          # plain-English codebase Q&A
wednesday-skills chat "what breaks if I change auth.ts"    # blast radius in plain English
wednesday-skills chat "which files have no tests and risk above 70"
wednesday-skills chat "path from checkout to database"
wednesday-skills chat "what changed in the last 30 days"
wednesday-skills drift                    # architecture drift vs PLAN.md constraints
wednesday-skills drift --since abc1234    # new drift only (PR review)
wednesday-skills drift --rule frontend-never-imports-db --fix
wednesday-skills gen-tests --dry-run      # preview targets
wednesday-skills gen-tests                # generate tests for high-risk uncovered files
wednesday-skills gen-tests --min-risk 70  # critical files only

wednesday-skills list                     # list installed skills
```

---

## Brownfield intelligence

Point any agent at a codebase it has never seen. It reads the graph — not raw source.

```bash
# First time setup (run once per project)
wednesday-skills analyze
wednesday-skills summarize   # needs OPENROUTER_API_KEY for LLM summaries

# After that — graph updates automatically on every commit (< 1s, zero LLM)
```

After setup, Claude Code reads `.wednesday/codebase/` instead of raw files:

```
Ask: "what does userService do"          → reads summaries.json
Ask: "what breaks if I change auth.ts"   → runs blast radius on dep graph
Ask: "fix this file"                     → checks risk score first, warns if > 80
```

**Safe change workflow:**
```bash
wednesday-skills score src/services/auth.ts    # check risk before touching
wednesday-skills blast src/services/auth.ts    # see what depends on it
# make your change
# post-commit hook updates the graph automatically
```

**Risk score bands:**

| Score | Band | Action |
|-------|------|--------|
| 0–30 | Low | Proceed |
| 31–60 | Medium | Review |
| 61–80 | High | Senior review |
| 81–100 | Critical | Explicit approval required |

**Language coverage:**

| Language | Static | + Gap subagents |
|----------|--------|-----------------|
| TypeScript / JavaScript | 95% | 95% |
| Go | 92% | 92% |
| GraphQL | 90% | 90% |
| NestJS | 60% | 88% |
| Serverless | 75% | 93% |
| React Native | 90% | 93% |
| Kotlin (basic) | 70% | 70% |
| Swift / SwiftUI / UIKit | 75% | 75% |

**Cost:** Full scan of 500 files costs $0.00 (zero LLM). Summaries ~$0.10 one-time. Ongoing < $0.05/month per project.

---

## Codebase chat

Ask any question about the codebase in plain English. Most answers are free — backed by the graph, not LLM guesses.

```bash
wednesday-skills chat "who wrote the payment module"
wednesday-skills chat "what breaks if I rename tokenService"
wednesday-skills chat "which files have zero tests and risk above 70"
wednesday-skills chat "path from checkout button to database write"
wednesday-skills chat "what changed in the last 30 days"
```

**How it works:**

| Question type | Method | Cost |
|---|---|---|
| Who wrote / when | git log | $0.00 |
| What does X do | summaries.json lookup | $0.00 |
| What breaks if | BFS blast radius | $0.00 |
| Which modules match criteria | graph filter | $0.00 |
| What changed recently | git log + diff | $0.00 |
| Path from X to Y | BFS traversal | $0.00 |
| Complex synthesis | Haiku on max 20-node subgraph | ~$0.005 |

Every answer cites its source. "Not mapped" is returned when data is missing — never a guess.

---

## Architecture drift detection

Compare the actual codebase against the intended design in `PLAN.md`. Catches boundary violations before they merge.

```bash
wednesday-skills drift                # full check
wednesday-skills drift --since HEAD~5 # only new violations (for PR review)
wednesday-skills drift --fix          # show suggested fix for each violation
```

Add machine-readable constraints to `PLAN.md`:

```json
{
  "boundaries": [
    {
      "rule": "frontend-never-imports-db",
      "description": "Frontend must never import DB layer directly",
      "from": "src/app/**",
      "to": "src/lib/db/**",
      "type": "forbidden"
    },
    {
      "rule": "no-circular-deps",
      "description": "No circular dependencies anywhere",
      "scope": "**",
      "type": "no-cycle"
    }
  ]
}
```

**Violation types:** `forbidden`, `ownership`, `no-direct-import`, `no-cycle`

Returns non-zero exit code — plug directly into CI:

```yaml
- run: wednesday-skills drift --since ${{ github.event.pull_request.base.sha }}
```

---

## Test generation

Generate test files for high-risk, uncovered modules. Context is built from the graph — real callers, real mocks, real historical bugs.

```bash
wednesday-skills gen-tests --dry-run      # preview targets ranked by priority
wednesday-skills gen-tests                # generate (requires OPENROUTER_API_KEY)
wednesday-skills gen-tests --min-risk 70  # critical files only
wednesday-skills gen-tests --file src/auth/tokenService.ts
```

Targets files where `riskScore > 50 AND coverage < 30%`, ranked by `riskScore × (100 - coverage)`.

Each test file includes:
- Correct mocks (from actual graph imports, not guessed)
- Tests for real callers' usage patterns
- Coverage of historical bug-fix commits
- Framework-appropriate patterns (jest/vitest/mocha auto-detected)

---

## Terminal dashboard

```
wednesday-skills dashboard
```

Requires `GITHUB_TOKEN` env var. Shows:
- Active PRs and fix counts
- Triage queue per PR
- Installed skills
- OpenRouter usage and cost

Press `r` to refresh, `q` to quit.

---

## Greenfield planner

```bash
# Option 1: create BRIEF.md first
echo "Build a todo app with auth and teams" > BRIEF.md
wednesday-skills plan

# Option 2: pass brief inline
wednesday-skills plan --brief "Build a todo app with auth and teams"
```

Requires `OPENROUTER_API_KEY` in `.env`. Outputs `PLAN.md` and `CODEBASE.md`.

---

## Environment variables

Copy `.env.example` to `.env` and fill in:

```
OPENROUTER_API_KEY=   # required for plan, triage, summarize, fill-gaps
GITHUB_TOKEN=         # required for dashboard PR panel
```

For GitHub Actions (triage, stale deps), add `OPENROUTER_API_KEY` as a repo secret.

---

## Supported AI tools

| Tool | Configured via |
|------|---------------|
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| Antigravity | `~/.gemini/antigravity/skills/` (run `wednesday-skills sync`) |
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |

---

## Project layout after install

```
your-project/
├── CLAUDE.md
├── GEMINI.md
├── .cursorrules
├── .wednesday/
│   ├── config.json
│   ├── tools.json
│   ├── skills/
│   │   ├── git-os/
│   │   ├── pr-review/
│   │   ├── greenfield/
│   │   ├── sprint/
│   │   ├── deploy-checklist/
│   │   ├── wednesday-dev/
│   │   ├── wednesday-design/
│   │   ├── brownfield-query/
│   │   ├── brownfield-fix/
│   │   ├── brownfield-gaps/
│   │   ├── brownfield-chat/      # Phase 3 — plain-English codebase Q&A
│   │   └── brownfield-drift/     # Phase 3 — architecture drift detection
│   ├── codebase/              # generated by wednesday-skills analyze
│   │   ├── dep-graph.json
│   │   ├── summaries.json
│   │   ├── MASTER.md
│   │   └── analysis/
│   │       ├── safety-scores.json
│   │       ├── dead-code.json
│   │       ├── api-surface.json
│   │       └── conflicts.json
│   └── hooks/
│       ├── post-commit        # zero LLM, < 1s
│       └── post-merge
└── .github/
    └── workflows/
        ├── commit-lint.yml
        ├── triage.yml
        └── stale-deps.yml     # weekly dependency check
```

---

## Roadmap

- Phase 1: Install, configure, git hooks, greenfield planner
- Phase 2: Brownfield intelligence — dep graph, risk scores, summaries, MASTER.md
- Phase 3: Chat, drift detection, test generation ← *current*

## License

MIT — Wednesday Solutions
