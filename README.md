# Wednesday Agent Skills

Transform any repository into an **AI-aware, intelligent environment** — a codebase that any AI agent can jump into on day one without making junior-level mistakes.

```bash
npx @wednesday-solutions-eng/ai-agent-skills install
```

---

## What This Is

Most AI agents in large codebases fail in the same ways: they hallucinate structure, waste tokens re-reading files they've seen before, and make changes without knowing what will break. This system solves all three.

It works by pre-computing a **structural dependency graph** (SQLite, AST-based, zero LLM) of your entire codebase once, then giving every AI agent — Claude Code, Cursor, Gemini CLI, GitHub Copilot — a precise manual for how to work in *your specific project*. From that point on, structural questions are answered from the graph in milliseconds, not from re-reading source files.

## What You Get After Install

This system integrates directly with **Claude Code**, **Gemini**, and other AI tools as an **on-demand skill**, feeding them structured repo context and enforcing local guardrails. **Answering structural questions via our pre-computed graph saves 70–90% of LLM tokens per query.**

### 1. Unified Codebase Intelligence Hub (`.wednesday/`)
- **AST-parsed Dependency Graph (`graph.db`)**: Builds and maintains a SQLite database mapping every import, export, and function call across JS, TS, Python, Go, Swift, etc. This eliminates the need for AI agents to repeatedly read files, reducing LLM token consumption by up to 90%.
- **Living Agent Configuration Files**: Automatically generates and updates `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, and `.github/copilot-instructions.md` with available skills and rules.

### 2. Guardrails and Enforced Quality Standards
- **Complexity Gates**: Enforces a cyclomatic complexity limit of `8` before code is submitted.
- **Approved Design Assets**: Enforces UI design rules, preventing developers or AI agents from creating custom/duplicate UI components and restricting imports to approved libraries (e.g. shadcn, Magic UI).
- **Git and Commit Discipline**: Automatically installs git hooks:
  - `commit-msg`: Enforces conventional commit formatting via `commitlint`.
  - `pre-commit`: Requires a `@wednesday-skills:purpose` header on new files.
  - `post-commit` / `post-merge`: Automatically maintains and syncs the dependency graph in `< 1s` using incremental updates.

### 3. Immediate Change & Impact Analysis
- **Blast Radius Analysis (`blast <file>`)**: Instantly lists direct and transitive dependents that will be affected if a specific file or symbol changes.
- **Audit-ready Safety Scoring (`score <file>`)**: Computes a detailed file risk score from `0` to `100` using import volume, public contracts, test coverage, and historical git bug history.

### 4. Automated Multi-Agent Architecture Planner (`plan`)
- **Parallel Synthesis**: Triggers a parallel planning pipeline running PM, Architect, and Security personas simultaneously on any project brief. It resolves technical disagreements (tensions) and synthesizes a production-ready `PLAN.md` outlining phase breakdowns, JWT auth strategies, and threat mitigations.

### 5. Seamless Skill Registry & Cost-Optimized Analytics
- **On-Demand Package Management**: Use `ws-skills search` and `ws-skills add` to pull community-built skills. Enforces PR review fixes (`@agent fix all`) as atomic commits with zero friction.
- **Up to 99% Cost Savings**: Structural queries are automatically routed to free-tier fallback models (Gemma 3, Qwen 2.5) first, saving up to 99% on API bills (reducing a $0.1620 Sonnet analysis query down to $0.0013). Run `ws-skills stats --cost` to inspect monthly cost breakdowns locally.

---

## Why Use This

### For AI Agents

| Without this system | With this system |
|---------------------|-----------------|
| Reads 20 raw files to answer "what does auth do?" — 6,000 tokens | Queries `graph.db` — 0 tokens |
| Guesses at dependency structure | BFS traversal on verified AST edges |
| Makes changes with no risk context | Checks blast radius before touching anything |
| Forgets conventions between sessions | Reads enforced rules from `CLAUDE.md` / `.cursorrules` on every turn |
| Produces inconsistent commit messages | Every commit enforced by `commit-msg` hook via commitlint |

### For Development Teams

**Speed** — New AI agents (and new developers) are productive on day one. `MASTER.md` gives full architectural context without reading a single source file.

**Safety** — High-risk files (risk score > 80) trigger a mandatory review pause before any AI is allowed to edit them. Blast radius is computed before the first keystroke.

**Cost** — Pre-computed graphs reduce LLM token spend on structural questions by 70–90%. Every `map` run prints a breakdown:

```
━━━ Token Usage Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Command:       map
  LLM calls:     18   (6 cache hits → 0 tokens)
  Tokens used:   9,240  (in: 6,800 / out: 2,440)
  Baseline est:  54,000  (cost of reading raw files)
  ▼ 44,760 tokens saved  (82%)
  Cost:          $0.0013  (baseline: $0.1620 vs Claude Sonnet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Consistency** — All AI tools (Claude, Gemini, Cursor, Copilot) follow the same standards because they all read from the same source. No more "Claude lets me do X but Cursor blocks it."

**Clean git history** — Conventional commits enforced at the hook level. Every PR follows the same shape.

---

## Installation

**Requirements:** Node.js ≥ 18

```bash
# Option 1 — npx (no setup)
npx @wednesday-solutions-eng/ai-agent-skills install

# Option 2 — global
npm install -g @wednesday-solutions-eng/ai-agent-skills
wednesday-skills install

# Option 3 — shell (no npm)
bash install.sh
```

Run in your project root. The installer:
1. Copies skills into `.wednesday/skills/`
2. Writes `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`
3. Installs git hooks: `commit-msg`, `pre-commit`, `post-commit`, `post-merge`
4. Symlinks skills into `.claude/skills/` for Claude Code's skill picker
5. Writes `.commitlintrc.json` with GIT-OS conventional commit rules

**No API key needed** when using skills inside Claude Code, Cursor, or Gemini CLI. The IDE is the intelligence engine — skills are standard markdown instructions.

API keys are only needed for standalone CLI commands (`map`, `summarize`, `gen-tests`):

```bash
wednesday-skills config        # interactive setup wizard
```

Or add to `.env`:
```
OPENROUTER_API_KEY=...         # cheaper, recommended (Gemini Flash-Lite default)
ANTHROPIC_API_KEY=...          # fallback
GITHUB_TOKEN=...               # for dashboard PR data
```

---

## How to Use It

### Day 1 — Map the Codebase

```bash
wednesday-skills map --full
```

This runs the full pipeline: AST parse → dependency graph → module summaries → `MASTER.md`. On a 500-file codebase it takes ~2 minutes and costs under $0.01 using Gemini Flash-Lite.

After this, the graph auto-updates on every commit. You never run `map` again unless you want a full refresh.

### Every Day — Just Talk to the AI

Once mapped, your AI agent already knows the codebase. Open Claude Code or Cursor and ask naturally:

**Understanding the codebase:**
```
"Walk me through how a payment is processed."
"What does the auth middleware do?"
"Who owns the billing module?"
```

**Before making a change:**
```
"Is it safe to change the signToken function signature?"
"What breaks if I rename UserService?"
```

**Starting a new task:**
```
"Start ticket: Add rate limiting to the login endpoint."
→ Creates branch feat/rate-limiting-login
→ Prints PR description template
→ Enforces atomic commits throughout
```

**PR workflow:**
```
"@agent fix #2 and #4"          # fix specific review comments
"@agent fix all"                 # fix everything in the queue
```

**After shipping:**
```
"Run pre-deploy checklist for the auth service."
"Generate an onboarding guide for the payments module."
```

---

## Skills Reference

### Core Workflow

| Skill | Trigger | What happens |
|-------|---------|-------------|
| `wednesday-git` | Starting a task, committing, opening a PR | Enforces branch naming, atomic commits, conventional messages, GIT-OS PR format |
| `standards-kit` | Writing any code or UI | Blocks custom components, enforces complexity < 8, naming conventions, import ordering |
| `pr-review` | `@agent fix #N` in PR comments | Fetches comments, categorizes by impact, applies fixes as separate atomic commits |
| `deploy-checklist` | Pre/post deploy | Walks env vars, migrations, rollback plan, smoke tests, monitoring |
| `greenfield` | New project planning | Runs Architect + PM + Security personas in parallel, produces `PLAN.md` with tensions |

### Brownfield Intelligence

| Skill | Trigger | What happens |
|-------|---------|-------------|
| `codebase-intel` | Any structural question or pre-edit check | Queries `graph.db` for impact, risk score, blast radius, entry points, dead code |
| `brownfield-drift` | Architecture review or PR merge | Validates code boundaries against `PLAN.md` — blocks domain spillage |
| `brownfield-e2e-gen` | Test coverage gaps | Generates tests using real AST callers and mock behavior, not scaffolding |

---

## Scenarios

### Inheriting a Legacy Codebase

```
You: "Map this codebase completely."
```
AI runs `wednesday-skills map --full`. After 2 minutes you have:
- `MASTER.md` — full architecture in plain English
- Risk scores on every file (0–100)
- Circular dependency report
- Dead code finder
- Module ownership from git blame

From this point, any structural question is answered from the graph, not from re-reading files.

---

### Fixing a Bug in a High-Risk Module

```
You: "Fix the token expiration bug in auth.ts."
```
AI checks blast radius before writing a single line. If risk score > 80:

```
⚠ HIGH RISK — auth.ts has risk score 87
  This file is imported by 14 modules across Auth and Billing.
  Recommend running these 3 tests before editing: [list]
  Proceed? (y/n)
```

Only after your confirmation does it write code — then commits with `fix(auth): Resolve token expiry on silent refresh`.

---

### New Developer Onboarding

```
You: "Generate an onboarding guide for the payments module."
```
AI uses recursive SQL traversal on `graph.db` to trace the full request path from API entry point to database layer, producing a focused Mermaid diagram and file reading order — specific to the exact layer the developer needs to touch.

---

### Architecture Review Before a PR Merge

```
You: "Check if this PR follows our architecture."
```
`brownfield-drift` reads `PLAN.md` boundary rules and validates them against the actual import graph. If a frontend module starts importing from the database layer, it's caught here before merge.

---

## CLI Reference

```bash
# Setup
wednesday-skills install                   # install + configure all agents
wednesday-skills config                    # interactive API key and model setup
wednesday-skills sync                      # re-sync all agent config files
wednesday-skills sync --tool cursor        # re-sync one specific agent

# Codebase Intelligence
wednesday-skills map --full               # full AST parse → graph.db → MASTER.md
wednesday-skills map --incremental        # update changed files only (< 1s)
wednesday-skills blast <file>             # blast radius report for a file
wednesday-skills score <file>             # risk score 0–100
wednesday-skills dead                     # dead files and unreferenced exports
wednesday-skills drift                    # architecture drift vs PLAN.md
wednesday-skills chat "question"          # plain-English codebase Q&A
wednesday-skills onboard                  # onboarding guide for a module

# Git & PR
wednesday-skills pr                       # validate + push + open PR
wednesday-skills coverage                 # test coverage report
wednesday-skills sonar                    # SonarQube report

# Skill Registry
wednesday-skills list                     # installed skills
wednesday-skills search <term>            # search community registry
wednesday-skills add <skill>              # install from registry
wednesday-skills update                   # update all skills
wednesday-skills stats                    # token usage and cost breakdown
```

---

## Project Layout After Install

```
your-project/
├── CLAUDE.md                          ← Claude Code instructions (auto-managed)
├── GEMINI.md                          ← Gemini CLI instructions (auto-managed)
├── .cursorrules                       ← Cursor instructions (auto-managed)
├── .github/
│   └── copilot-instructions.md        ← Copilot instructions (auto-managed)
├── .commitlintrc.json                 ← Conventional commit rules
└── .wednesday/
    ├── tools.json                     ← Which agents are registered
    ├── config.json                    ← API keys and model preferences
    ├── skills/                        ← Installed skill SKILL.md files
    ├── graph.db                       ← SQLite dependency graph (auto-updated)
    └── codebase/
        ├── MASTER.md                  ← AI-generated architecture guide
        ├── summaries.json             ← Module purpose index
        └── dep-graph.json             ← Serialized graph for tooling
```

Git hooks (in `.git/hooks/`):

| Hook | What it enforces |
|------|-----------------|
| `commit-msg` | Conventional commit format via commitlint |
| `pre-commit` | Module header required on new JS/TS files |
| `post-commit` | Incremental graph update (< 1 second) |
| `post-merge` | Full graph refresh after a pull |

---

## Supported Languages

The dependency graph parser handles: **JavaScript, TypeScript, Python, Go, Ruby, Java, Kotlin, Swift, C, C#, PHP, GraphQL**

---

## Roadmap

- ✅ Phase 1 — Install, configure, git hooks, greenfield planner
- ✅ Phase 2 — Brownfield intelligence: dep graph, risk scores, summaries, MASTER.md
- ✅ Phase 3 — Chat, drift detection, test generation
- ✅ Phase 4 — Public registry, skill builder, usage analytics
- 🔄 Phase 5 — MCP server for direct IDE tool integration, team-level skill sharing

---

## Documentation

| Guide | What it covers |
|-------|---------------|
| [Getting Started](docs/getting-started.md) | Install, configure, first map, recommended workflow |
| [Architecture](docs/architecture.md) | Engine internals, adapters, graph, data flows |
| [CLI Reference](docs/cli-reference.md) | Every command with flags and examples |
| [Best Practices](docs/best-practices.md) | Token efficiency, CI setup, team workflows |
| [Token Cost Report](docs/token-cost-report.md) | How cost tracking works, pricing table, model selection |

---

**License:** MIT — [Wednesday Solutions](https://wednesday.is)
