# Wednesday Agent Skills

AI skills for Wednesday Solutions projects — git discipline, PR automation, terminal dashboard, greenfield planning, and brownfield codebase intelligence with real-time chat, drift detection, and test generation.

---

## 1. Installation

### Requirements
- Node.js ≥ 18
- npm ≥ 8

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

Run in your project root. The installer:
1. Copies skills into `.wednesday/skills/`
2. Writes agent config files (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`)
3. Installs git hooks (`post-commit`, `post-merge`) for automatic graph updates
4. Prompts for optional coverage and Sonar integration
5. Symlinks skills into `~/.claude/skills/` for Claude Code discovery

---

## 2. Configuration & AI Tools

**No API key needed to use skills inside Claude Code, Cursor, or Gemini CLI.** 
When inside an AI IDE, the IDE acts as the intelligence engine — skills are standard instructions, not local scripts.

### Supported AI tools
| Tool | Configured via |
|------|---------------|
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| Antigravity | `~/.gemini/antigravity/skills/` (run `wednesday-skills sync`) |
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |

### Environment Variables
API keys are only required for standalone CLI workflows (`plan`, `summarize`, `gen-tests`). 
Run the interactive configuration wizard:

```bash
wednesday-skills config
```

Or manually add to `.env`:
- `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`: Used by offline LLM-backed tools.
- `GITHUB_TOKEN`: Used by `wednesday-skills dashboard` to fetch PR data.

---

## 3. Every Skill Explained

### Core Workflow Skills
| Skill | What it does |
|---------|-------------|
| `git-os` | Enforces conventional commits — no bad or ambiguous commit messages allowed. |
| `pr-review` | Gemini fix queue — categorizes PR comments by impact, applies fixes upon dev approval. |
| `deploy-checklist` | Walks through pre-deploy checks and post-deploy monitoring checklists. |
| `wednesday-dev` | Enforces import ordering, file complexity limits (max 8), and naming conventions. |
| `wednesday-design` | Asserts the use of 492+ approved UI components, design tokens, and animation patterns. |
| `sprint` | Translates ticket IDs into git branches, PR titles, and description templates automatically. |
| `greenfield` | Parallel AI personas (Architect, PM, Security) produce a comprehensive `PLAN.md` in minutes. |

### Brownfield Intelligence Skills
| Skill | What it does |
|---------|-------------|
| `brownfield-chat` | Plain-English codebase Q&A using structural graphs (zero hallucinated data). |
| `brownfield-query` | Deterministic structural queries returning dependencies, endpoints, and file metrics from SQLite (`graph.db`). |
| `brownfield-fix` | Calculates Risk score + blast radius before the AI is allowed to edit a file. |
| `brownfield-drift` | Enforces architecture boundaries defined in `PLAN.md` preventing domain spillage. |
| `brownfield-gaps` | Enhances dynamic runtime graph coverage via localized subagents. |

### Feature Deep Dives

#### 🧠 Terminal Dashboard (`wednesday-skills dashboard`)
Provides an interactive CLI interface for tracking open PRs, unassigned semantic fix queues, installed skills status, and detailed LLM token cost breakdowns.

#### 💰 Token Cost & Savings Report
Every LLM-backed command (`map`, `summarize`, `gen-tests`, etc.) automatically prints a cost report after it runs:

```
━━━ Token Usage Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Command:       map
  LLM calls:     18   (6 cache hits → 0 tokens)
  Tokens used:   9,240  (in: 6,800 / out: 2,440)
  Baseline est:  54,000  (cost of reading raw files)
  ▼ 44,760 tokens saved  (82%)
  Cost:          $0.0013  (baseline: $0.1620 vs Claude Sonnet)
  ▼ $0.1607 saved by using this model
  ──────────────────────────────────────────────────
  Operation          Used  Baseline   Saved%  Calls
  arch-overview     1,320     6,000    78%  1
  summarize         5,480    15,000    63%  12 +6cached
  gap-fill          2,440     9,000    72%  5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Baseline** is computed as what Claude Sonnet ($3/M tokens) would spend reading the equivalent raw source files directly. **Actual cost** reflects the real model used (e.g. `gemini-2.5-flash-lite` at $0.10/M). The difference is your savings from both the pre-computed graph *and* the cheaper model selection.

→ Full details: [docs/token-cost-report.md](docs/token-cost-report.md)

#### 🛡 Architecture Drift Detection (`wednesday-skills drift`)
Validates that the actual code structure safely adheres to the constraints in `PLAN.md` (e.g. `frontend-never-imports-db`, `no-circular-deps`). Designed to plug into CI/CD pipelines to block architectural decay during PRs.

#### 🧪 AI Test Generation (`wednesday-skills gen-tests`)
Generates comprehensive tests using actual callers and real AST mock behavior to safely wrap high-risk, un-covered files, using historical bug-fix commits as context.

#### 💬 Codebase Chat (`wednesday-skills chat "your question"`)
Ask plain-English questions ("Who wrote the auth layer?", "What breaks if I rename X?") and receive verified answers parsed instantly from local ASTs and Git history. Saves 100% of LLM tokens by using offline parsing.

---

## 4. Scenario-Based Use Cases

All workflows run entirely inside Claude Code or Gemini CLI. The IDE loads the relevant skills seamlessly and intuitively based on your conversation.

### A. The Greenfield Project (Starting from scratch)

**Scenario: You have an idea and need an architectural robust plan.**
1. **You say:** *"Plan this project: Build a realtime collaborative text editor."*
2. **AI Action:** Loads the `greenfield` skill. The framework spins up parallel Architect, PM, and Security AI personas.
3. **Outcome:** A comprehensive `.wednesday/plans/PLAN.md` with system architecture, security risks, phased tickets, and architectural boundaries.
4. **Follow Up:** *"Start the first ticket."* → Loads the `sprint` skill → Sets up your git branch and PR draft automatically.

### B. First Time on an Existing Codebase (Brownfield Intelligence)

**Scenario: You just inherited a completely undocumented, legacy codebase.**
1. **You say:** *"Map this codebase completely."*
2. **AI Action:** Automatically triggers `wednesday-skills map --full`, parsing thousands of files dynamically into a high-performance `.wednesday/graph.db` database. 
3. **Outcome:** Generates `MASTER.md` containing global architectural user flows, and `summaries.json` for natural language querying. Future operations no longer require passing thousands of tokens of context files; the agent directly queries the pre-computed SQLite graph.

### C. New Developer Onboarding

**Scenario: A new developer joins the backend API squad and is confused.**
1. **You say:** *"Generate an onboarding guide for the backend."*
2. **AI Action:** Resolves the `onboard` intent, and utilizes the SQLite Recursive CTE framework to trace deeply nested request flows natively from CLI entry points to the core domain logic.
3. **Outcome:** Provides an extremely focused, functional step-by-step Mermaid diagram execution flow and reading guide specifically for the exact layer the developer needs to touch.

### D. Fixing a Bug in a High-Risk Monolith 

**Scenario: You've been tasked to fix a bug deep within a massively coupled module.**
1. **You say:** *"Fix the token expiration bug in `auth.ts`."*
2. **AI Action:** Pre-emptively invokes `brownfield-fix` to calculate the **blast radius** of `auth.ts` inside `graph.db` *before writing any code*. 
3. **Outcome:** If the file has a critical impact score (>80), Claude forcefully pauses, refuses to touch the code, and dictates the cascading components explicitly, asking for developer verification before proceeding safely. Once approved, handles commits using the pristine `git-os` skill.

### E. Automating PR Code Reviews and Fixes

**Scenario: The lead dev left 5 semantic code review comments on your Pull Request.**
1. **You say:** *"@agent fix #2 and #4"* or *"@agent fix all"*
2. **AI Action:** Loads `pr-review`, parses the exact GitHub comments, structures security, safety, and style impacts, and isolates each fix into discrete, clean git commits.
3. **Outcome:** PR feedbacks are iteratively satisfied without polluting commit history or breaking CI checks.

### F. Improving Code Coverage Programmatically

**Scenario: A mission-critical module handles real-time payments but has 0% test coverage.**
1. **You say:** *"Generate tests for uncovered critical files."*
2. **AI Action:** Evaluates `gen-tests --min-risk 75` to rank code that is both completely uncovered and possesses a terrifying blast radius. 
3. **Outcome:** Produces functional, mocked `.test.js` files perfectly integrated into your framework, using deterministic AST connections instead of hallucinatory scaffolding.

---

## 5. CLI Commands Reference

```bash
# Setup
wednesday-skills install                  # install + configure all agents
wednesday-skills config                   # interactive API key and model setup
wednesday-skills sync                     # re-sync all tool adapters

# Intelligence
wednesday-skills map --full               # Complete AST extraction and flow inference into graph.db
wednesday-skills onboard                  # Contextual, step-by-step interactive flows
wednesday-skills drift                    # Validates architecture against PLAN.md
wednesday-skills drift --since HEAD~5     # Run drift checks on a specific diff (PR verification)
wednesday-skills chat "question"          # Instantly ask codebase questions using BFS limits

# Analytics
wednesday-skills blast <file>             # Computes total risk radius to dependent modules
wednesday-skills score <file>             # Outputs deterministic blast score 0–100
wednesday-skills dead                     # Maps out dead files and unreferenced exports
wednesday-skills stats                    # Renders skill utilization metrics vs OpenRouter token costs

# Skill Registry
wednesday-skills list                     # list installed skills
wednesday-skills search <term>            # search community skill registry
wednesday-skills add <skill>              # install a skill from the registry
wednesday-skills update                   # update all installed skills to latest
```

---

## 6. Project Layout After Setup

```
your-project/
├── CLAUDE.md                # Claude Code Base Instructions 
├── GEMINI.md                # Gemini Base Instructions
├── .wednesday/
│   ├── config.json          # Core environment + IDE behavior settings
│   ├── skills/              # Installed markdown skills logic & tool scripts
│   ├── graph.db             # Core SQLite graph database mapping the full AST
│   ├── codebase/              
│   │   ├── summaries.json     
│   │   ├── MASTER.md        # AI generated architectural flow-centric guide     
│   └── hooks/               # Git-hooks that seamlessly update graph.db instantly
```

---

## 7. Documentation

Full documentation is in the [`docs/`](docs/) folder:

| Guide | What it covers |
|-------|---------------|
| [Getting Started](docs/getting-started.md) | Install, configure, first map, recommended workflow |
| [Architecture](docs/architecture.md) | How the system works — engine, adapters, graph, data flows |
| [CLI Reference](docs/cli-reference.md) | Every command with flags, outputs, and examples |
| [Skills Reference](docs/skills-reference.md) | Every skill — when to use it and how it works |
| [Best Practices](docs/best-practices.md) | When to run each command, token efficiency, CI setup |
| [Token Cost Report](docs/token-cost-report.md) | How cost tracking works, pricing table, model selection |

---

## 8. Roadmap & License

- Phase 1: Install, configure, git hooks, greenfield planner ✓
- Phase 2: Brownfield intelligence — dep graph, risk scores, summaries, MASTER.md ✓
- Phase 3: Chat, drift detection, test generation ✓
- Phase 4: Public registry, skill builder, usage analytics, flow-centric automation ✓ *current*

**License:** MIT — Wednesday Solutions
