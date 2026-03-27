# Best Practices

## The Core Mental Model

Think of this system as a pre-computed index for your AI agent — exactly like a search engine index. You build it once, keep it updated, and queries are instant and cheap.

**Wrong approach:** Ask the agent to read files and figure things out.
**Right approach:** Build the graph first, then ask the agent questions.

---

## When to Run Each Command

### `map` — run this first and after large merges

```bash
wednesday-skills map --full   # initial + after big merges
```

The `post-commit` hook runs incremental updates automatically after every commit. You only need to run `map --full` manually when:
- First time setup
- After a large merge (hundreds of files changed)
- After pulling significant upstream changes
- After updating the skill package

### `analyze` — run when you want risk signals

```bash
wednesday-skills analyze --git-history
```

`analyze` adds the intelligence layer on top of the graph: risk scores, dead code, legacy health, comment intel. The `--git-history` flag adds git bug-fix signal to risk scoring — worth the extra time.

Run this:
- After `map` on a new codebase
- Before a major refactor
- Before generating tests

### `summarize` — run once per sprint or before a big code review

```bash
wednesday-skills summarize
```

Summaries are cached by file hash. Only changed files are re-summarized. After the first run, subsequent runs are fast and cheap. Run it:
- Once after initial setup
- Before onboarding a new developer
- Before generating a refactor plan
- When `MASTER.md` feels stale

### `fill-gaps` — run on high-risk files with dynamic patterns

```bash
wednesday-skills fill-gaps --min-risk 70
```

Dynamic patterns (event emitters, dynamic require, global injection) can't be statically parsed. Gap filling resolves them via Haiku subagents. Only do this for files you're about to edit heavily — it's not necessary for all files.

---

## Using Skills in Your Agent

### Before editing any risky file

Always run the `brownfield-fix` skill before touching files with unknown blast radius:

```
"Run brownfield-fix before I edit src/payments/processor.ts"
```

This forces the agent to check the risk score and blast radius before writing any code. If the risk is Critical (>80), the agent will pause and show you all affected files before proceeding.

### Asking structural questions

Use `brownfield-chat` for any structural question:

```
"What modules does auth.ts export?"
"What breaks if I rename createOrder in order-service.ts?"
"Which files have the highest risk score?"
"What's the blast radius of the database adapter?"
```

These return answers from the pre-computed graph — no LLM tokens spent.

### Asking "what does X do?"

```
"What does the payments module do?"
"What is src/core/engine.js responsible for?"
```

These hit `summaries.json` first. If missing, the agent reads `MASTER.md`. Only synthesizes via LLM if neither source has an answer.

### Enforcing architecture

Run `brownfield-drift` before merging any PR that crosses module boundaries:

```
"Check if this PR follows the architecture in PLAN.md"
```

Or in CI:

```bash
wednesday-skills drift --since HEAD~1
```

---

## Token Efficiency Tips

### Use OpenRouter with Gemini Flash Lite

The biggest cost saving comes from using `gemini-2.5-flash-lite` for summarization and gap-filling instead of Claude Sonnet. Set this in `.env`:

```bash
OPENROUTER_MODEL_HAIKU=google/gemini-2.5-flash-lite
```

Typical savings: **98%** vs Claude Sonnet reading raw files.

### Don't skip the cache

The system caches summaries by `file hash + exports hash`. Never delete `.wednesday/cache/hashes.json` unless you want to force a full rebuild. The cache is what makes subsequent `summarize` runs cheap.

### Use `--min-risk` on fill-gaps

Don't fill gaps on every file — only on the ones you're about to touch:

```bash
wednesday-skills fill-gaps --file "src/payments/**" --min-risk 60
```

### Check the token report after every run

Every command prints a cost report. If the cost seems high for the work done, check:
1. Are summaries being re-computed for unchanged files? (cache miss — check hashes.json)
2. Is the fallback chain hitting rate limits? (shows in logs as model switches)
3. Is `--full` being used when `--incremental` would work?

---

## Monorepo Setup

Run `map` from the monorepo root. Use `--ignore` to exclude generated and vendor directories:

```bash
wednesday-skills map --full \
  --ignore "**/generated/**" \
  --ignore "**/vendor/**" \
  --ignore "**/.next/**" \
  --ignore "**/dist/**"
```

The graph will cover all packages. Cross-package imports are tracked as edges, so blast radius works across package boundaries.

---

## CI/CD Integration

### Architecture drift check on every PR

```yaml
# .github/workflows/drift.yml
- name: Check architecture drift
  run: wednesday-skills drift --since origin/main
```

This fails the CI run if any commit in the PR introduces an architecture violation defined in `PLAN.md`.

### Incremental graph update on merge

```yaml
# .github/workflows/graph-update.yml
- name: Update dependency graph
  run: wednesday-skills map --incremental
```

Run this on merges to `main` to keep `graph.db` in sync for all agents that query it.

---

## Onboarding New Developers

The best way to onboard a developer to an unfamiliar codebase:

1. Make sure `map` and `summarize` have been run
2. Have them run: `wednesday-skills onboard`
3. Or in the agent: *"Generate an onboarding guide for the backend auth layer"*

The onboarding flow traces call chains from entry points down to the domain logic the developer needs to touch, and produces a Mermaid diagram of the execution flow.

---

## Refactoring Large Modules

Before starting a large refactor:

1. Check the blast radius: `wednesday-skills blast <file>`
2. Check the risk score: `wednesday-skills score <file>`
3. If risk is High or Critical, ask the agent to plan the refactor using the graph:
   ```
   "Plan a refactor to split payments/processor.ts into smaller modules"
   ```
   This uses `refactor-planner.js` which generates a GIT-OS-compliant multi-step plan with independent PRs — without reading raw source.

---

## Keeping the Graph Accurate

The graph is only as good as the data fed to it. Common issues:

**Problem:** A file shows 0 importers but you know it's used.
**Fix:** Check if it uses dynamic imports. Run `fill-gaps --file <that-file>`.

**Problem:** Risk scores seem too low.
**Fix:** Run `analyze --git-history` to include git bug-fix signals.

**Problem:** Summaries are stale after a major refactor.
**Fix:** Run `summarize` again. Only changed files will be re-summarized.

**Problem:** Architecture drift is showing false positives.
**Fix:** Review `PLAN.md` boundary rules. Constraints may need updating to reflect legitimate architectural changes.
