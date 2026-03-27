# Getting Started

## Prerequisites

- Node.js ≥ 18
- npm ≥ 8
- An AI agent: Claude Code, Gemini CLI, or Cursor

---

## Step 1 — Install

Run this in your project root:

```bash
npx @wednesday-solutions-eng/ai-agent-skills install
```

Or globally:

```bash
npm install -g @wednesday-solutions-eng/ai-agent-skills
wednesday-skills install
```

The installer:
1. Creates `.wednesday/skills/` with all skill markdown files
2. Writes agent config: `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`
3. Installs git hooks: `post-commit` and `post-merge` for automatic graph updates
4. Prompts for optional test coverage and Sonar integration

---

## Step 2 — Configure an API Key (Optional but Recommended)

Skills work inside Claude Code or Gemini CLI without any API key — the IDE is the intelligence engine.

An API key is only required for standalone commands that call LLMs directly: `map --full`, `summarize`, `gen-tests`, `fill-gaps`.

```bash
wednesday-skills config
```

This stores your key in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-...          # recommended — cheaper + more models
# or
ANTHROPIC_API_KEY=sk-ant-...          # works natively in Claude Code
```

**Recommended model config** (add to `.env`):

```bash
OPENROUTER_MODEL_HAIKU=google/gemini-2.5-flash-lite   # fast + cheap — used for summaries
OPENROUTER_MODEL_SONNET=google/gemini-2.5-flash        # heavier tasks
```

If no key is set, all free OpenRouter models are tried in sequence. You'll get results but with slower fallback chains.

---

## Step 3 — Map Your Codebase

This is the most important step. Run once after install, then again after large PRs.

```bash
wednesday-skills map --full
```

What happens:
- Parses every source file (JS, TS, Go, Python, Swift, Kotlin, Ruby, Java, PHP, C#, C++)
- Builds a dependency graph in `.wednesday/graph.db`
- Writes human-readable output to `.wednesday/codebase/dep-graph.json`
- Prints a token cost + savings report

This takes ~5–30 seconds depending on codebase size. Subsequent runs with `--incremental` only re-parse changed files (<1 second on a 5-file PR).

---

## Step 4 — Generate Summaries (Optional, Needs API Key)

```bash
wednesday-skills summarize
```

Generates:
- `MASTER.md` — per-file docs grouped by directory, with risk scores and blast radius
- `summaries.json` — one-sentence summary per file, cached by content hash
- `GUIDE.md` — architecture guide with primary flows and entry points

This is a one-time cost. Subsequent runs only re-summarize files that changed.

---

## Step 5 — Use Your AI Agent Normally

Once the graph is built, your AI agent automatically uses it. Open Claude Code or Gemini CLI and just ask questions:

```
"What breaks if I change auth.ts?"
"What does the payments module do?"
"Who imported userService incorrectly?"
"Generate tests for uncovered high-risk files."
"Fix the bug in order-processor.ts."
```

The agent reads the relevant skill, queries the pre-computed graph, and answers without reading any raw source files.

---

## Recommended Workflow

### Day 0 (project setup)

```bash
wednesday-skills install       # install skills + hooks
wednesday-skills config        # set API key
wednesday-skills map --full    # build initial graph
wednesday-skills summarize     # generate MASTER.md
```

### Every PR (automated by git hook)

The `post-commit` hook automatically runs incremental graph updates after every commit. No manual steps.

### When the graph feels stale

```bash
wednesday-skills map --full    # full rebuild
```

### When you want gap coverage for dynamic patterns

```bash
wednesday-skills fill-gaps     # resolve dynamic require/event-emit etc.
```

### Before touching a risky file

In your agent:
```
"Run brownfield-fix before I edit payments/processor.ts"
```

Or directly:
```bash
wednesday-skills score payments/processor.ts   # see risk score
wednesday-skills blast payments/processor.ts   # see dependents
```

---

## Common Questions

**Do I need an API key to use skills?**
No. Skills inside Claude Code or Gemini CLI use the IDE's built-in LLM. An API key is only needed for standalone CLI commands (`map --full`, `summarize`, `gen-tests`).

**How often should I run `map`?**
The `post-commit` hook runs incremental updates automatically. Run `map --full` after large merges or when you pull significant upstream changes.

**What if I don't use OpenRouter?**
Set `ANTHROPIC_API_KEY` instead. The system will use Claude Haiku and Sonnet directly. Slightly more expensive but equally reliable.

**Can I use free models?**
Yes. If you set `OPENROUTER_API_KEY` with no `OPENROUTER_MODEL_HAIKU`, the system tries a 5-model free fallback chain automatically.

**What languages are supported?**
JavaScript/TypeScript, Go, Python, Swift, Kotlin, Ruby, Java, PHP, C#, C/C++, GraphQL.

**Will it work on a monorepo?**
Yes. Run from the monorepo root. Use `--ignore` to exclude `node_modules`, vendor dirs, or generated files:

```bash
wednesday-skills map --ignore "**/generated/**" --ignore "**/vendor/**"
```
