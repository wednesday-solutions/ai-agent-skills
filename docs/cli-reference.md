# CLI Reference

All commands are available as `wednesday-skills <command>` or the short alias `ws-skills <command>`.

---

## Setup Commands

### `install`

```bash
wednesday-skills install [dir] [--skip-config] [--all]
```

Installs skills and configuration into a project.

- `dir` — target directory (default: current directory)
- `--skip-config` — skip the interactive API key prompt
- `--all` — install all optional integrations without prompting

**What it creates:**

| File | Purpose |
|------|---------|
| `.wednesday/skills/` | All skill markdown files |
| `CLAUDE.md` | Claude Code skill instructions |
| `GEMINI.md` | Gemini CLI skill instructions |
| `.cursorrules` | Cursor editor rules |
| `.github/copilot-instructions.md` | GitHub Copilot instructions |
| `.wednesday/hooks/` | Git hook scripts |

---

### `config`

```bash
wednesday-skills config
```

Interactive wizard for configuring API keys and model preferences. Writes to `.env`.

---

### `sync`

```bash
wednesday-skills sync [--tool <name>]
```

Re-injects updated skill content into all tool config files. Run after upgrading the package or adding new skills.

- `--tool claude` — sync only Claude Code config
- `--tool gemini` — sync only Gemini CLI config

---

## Intelligence Commands

### `map`

```bash
wednesday-skills map [dir] [--full] [--incremental] [--ignore <pattern>] [--report-only]
```

Parses your source files and builds the dependency graph.

- `--full` — full rebuild (ignores cache)
- `--incremental` — only re-parse files changed since last run (default when cache exists)
- `--ignore <pattern>` — glob pattern to exclude (can be repeated)
- `--report-only` — print stats without writing files

**Output files:**

| File | Description |
|------|-------------|
| `.wednesday/graph.db` | SQLite database (primary store) |
| `.wednesday/codebase/dep-graph.json` | Human-readable graph JSON |

After running, a token cost report is printed showing actual spend vs Claude Sonnet baseline.

---

### `analyze`

```bash
wednesday-skills analyze [dir] [--incremental] [--full] [--git-history]
```

Runs the full analysis pipeline on top of the graph.

- `--incremental` — only update changed files
- `--full` — rebuild everything
- `--git-history` — include git commit history signals in risk scoring

**Output files:**

| File | Description |
|------|-------------|
| `.wednesday/codebase/analysis/comments.json` | Tagged comments per directory |
| `.wednesday/codebase/analysis/legacy-report.json` | God files, circular deps, tech debt |
| `.wednesday/codebase/analysis/insights.json` | Codebase-wide metrics |

---

### `summarize`

```bash
wednesday-skills summarize [dir]
```

Generates LLM summaries for every file and writes `MASTER.md`. Requires an API key.

**Output files:**

| File | Description |
|------|-------------|
| `.wednesday/codebase/summaries.json` | One-sentence summary per file |
| `.wednesday/codebase/MASTER.md` | Full per-file docs grouped by directory |
| `.wednesday/codebase/GUIDE.md` | Architecture guide with primary flows |
| `.wednesday/codebase/SUMMARY.md` | Top-level codebase statistics |

Summaries are cached by `file hash + exports hash`. Only changed files are re-summarized on subsequent runs.

---

### `fill-gaps`

```bash
wednesday-skills fill-gaps [dir] [--file <pattern>] [--min-risk <num>] [--silent]
```

Resolves dynamic patterns the static parser missed (dynamic requires, event emitters, global injections). Calls Haiku with a 50-token cap per gap. Edges are only added when confidence ≥ 0.80.

- `--file <pattern>` — only fill gaps in matching files
- `--min-risk <num>` — only process files with riskScore above threshold (default: 50)
- `--silent` — suppress per-gap output

---

### `onboard`

```bash
wednesday-skills onboard [dir]
```

Interactive developer onboarding. Asks guided questions and generates a reading guide scoped to the layer you need to touch.

---

### `chat`

```bash
wednesday-skills chat "<question>" [dir]
```

Answers codebase questions using the pre-computed graph. Most questions return answers with zero LLM calls.

```bash
wednesday-skills chat "What calls userService?"
wednesday-skills chat "What breaks if I change auth.ts?"
wednesday-skills chat "Who wrote the payments module?"
wednesday-skills chat "List all files with risk above 80"
```

---

## Analysis Commands

### `blast`

```bash
wednesday-skills blast <file> [dir]
```

Shows the blast radius for a file — all files that would be affected if it changed.

```bash
wednesday-skills blast src/core/auth.ts
```

Output:
```
Blast radius: src/core/auth.ts
  Direct dependents:  4
  Transitive:        18
  Cross-language:     2
  Files: src/api/routes.ts, src/middleware/guard.ts, ...
```

---

### `score`

```bash
wednesday-skills score <file> [dir]
```

Shows the risk score (0–100) for a file.

```bash
wednesday-skills score src/payments/processor.ts
```

Output:
```
Risk score: src/payments/processor.ts
  Score: 84 / 100  [Critical]
  Dependents:     32 (×1.2 weight)
  Public contract: yes (+25)
  Test coverage:   12% (+12)
  Bug-fix commits: 4 (+12)
  Tech debt:       high (+15)

  Action: Do not edit without full blast-radius review and test coverage above 60%.
```

---

### `dead`

```bash
wednesday-skills dead [dir]
```

Lists dead code: files with no importers (and not an entry point) and exports with no usages.

```bash
wednesday-skills dead
```

Output:
```
Dead files (7):
  src/utils/legacy-formatter.js   (0 importers)
  src/helpers/old-validator.ts    (0 importers)
  ...

Orphaned exports (12):
  src/api/helpers.ts  →  formatDate (unused)
  ...
```

---

### `legacy`

```bash
wednesday-skills legacy [dir]
```

Generates a legacy health report: god files, circular dependencies, tech debt zones, unannotated dynamic patterns.

---

### `drift`

```bash
wednesday-skills drift [dir] [--rule <name>] [--since <commit>] [--fix]
```

Validates the codebase against architecture boundaries defined in `PLAN.md`.

- `--rule <name>` — check only a specific rule
- `--since <commit>` — only flag violations introduced after this commit (for PR checks)
- `--fix` — generate suggested fixes for each violation

```bash
wednesday-skills drift --since HEAD~5    # check the last 5 commits
```

---

### `api-surface`

```bash
wednesday-skills api-surface <file> [dir]
```

Distinguishes exports that are part of the public contract (imported by other modules) from internal-only exports.

---

### `trace`

```bash
wednesday-skills trace <file> [function] [dir]
```

Traces call chains from a file or specific function.

```bash
wednesday-skills trace src/api/routes.ts handleCreateOrder
```

---

### `stats`

```bash
wednesday-skills stats [dir]
```

Shows skill utilization metrics and historical LLM token costs from `.wednesday/token-log.json`.

---

## Code Quality Commands

### `gen-tests`

```bash
wednesday-skills gen-tests [dir] [--min-risk <num>] [--max-files <num>]
```

Generates test files for uncovered high-risk modules. Selects targets where `riskScore > min-risk` and `testCoverage < 30%`, sorted by `riskScore × (100 - coverage)`. Requires Sonnet-level API access.

- `--min-risk <num>` — minimum risk score to target (default: 50)
- `--max-files <num>` — cap on files to generate tests for (default: 5)

---

## Registry Commands

### `list`

```bash
wednesday-skills list [dir]
```

Lists all installed skills with descriptions.

---

### `search`

```bash
wednesday-skills search <term>
```

Searches the community skill registry.

---

### `add`

```bash
wednesday-skills add <skill-name>
```

Installs a skill from the registry into `.wednesday/skills/`.

---

### `update`

```bash
wednesday-skills update [skill-name]
```

Updates all installed skills (or a specific one) to the latest version.

---

## Dashboard

```bash
wednesday-skills dashboard [--pr <num>]
```

Launches an interactive terminal UI (built with Ink/React) for:
- Open PR tracking with review status
- Unassigned semantic fix queues
- Installed skills status
- Historical LLM token cost breakdown

- `--pr <num>` — jump directly to a specific PR

Requires `GITHUB_TOKEN` in `.env` for PR data.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key (preferred) |
| `ANTHROPIC_API_KEY` | Anthropic API key (fallback) |
| `OPENROUTER_MODEL_HAIKU` | Model for fast/cheap calls (default: `google/gemini-2.5-flash-lite`) |
| `OPENROUTER_MODEL_SONNET` | Model for heavy tasks (default: `google/gemini-2.5-flash`) |
| `ANTHROPIC_MODEL_HAIKU` | Anthropic model for fast calls (default: `claude-haiku-4-5-20251001`) |
| `ANTHROPIC_MODEL_SONNET` | Anthropic model for heavy tasks (default: `claude-sonnet-4-6`) |
| `GITHUB_TOKEN` | GitHub API token for dashboard PR data |
