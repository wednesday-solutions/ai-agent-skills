# Architecture

Wednesday Agent Skills is a brownfield codebase intelligence platform that sits between your source code and your AI agent. It pre-computes a dependency graph so the agent never needs to read raw source files to answer structural questions.

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Your AI Agent                             │
│          (Claude Code / Gemini CLI / Cursor)                 │
└────────────────────────┬─────────────────────────────────────┘
                         │  reads skills from
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                  Agent Skills (.wednesday/skills/)           │
│   brownfield-chat  brownfield-fix  git-os  greenfield  ...  │
└────────────────────────┬─────────────────────────────────────┘
                         │  queries
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                  graph.db  (SQLite)                          │
│         nodes | edges | symbols | metadata                  │
└────────────────────────┬─────────────────────────────────────┘
                         │  built by
                         ▼
┌──────────────────────────────────────────────────────────────┐
│               Intelligence Engine (src/brownfield/)         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Adapters │  │  Engine  │  │ Analysis │  │Summarization│  │
│  │ 11 langs │→ │ graph.js │→ │ 13 mods  │→ │ master-md  │  │
│  └──────────┘  │ store.js │  └──────────┘  └────────────┘  │
│                └──────────┘                                  │
└──────────────────────────────────────────────────────────────┘
                         │  fed by
                         ▼
              Your Source Code (any language)
```

## Core Principle: Pre-Compute, Don't Read

Without this system, an agent answering "what breaks if I change `auth.ts`?" reads dozens of raw source files — spending thousands of tokens and hallucinating edges it missed.

With this system:
1. `wednesday-skills map` parses everything once → writes to SQLite
2. The agent queries the graph directly — 0 tokens for structural questions
3. LLM is only called for things that genuinely require understanding: summaries, synthesis, test generation

---

## Module Map

### `src/brownfield/core/` — Shared Infrastructure

| Module | Purpose |
|--------|---------|
| `llm-client.js` | Unified LLM client. Tries OpenRouter first (cheaper), falls back to Anthropic. Manages a 5-model fallback chain on rate limits. |
| `token-logger.js` | Tracks every LLM call, computes actual dollar cost vs Claude Sonnet baseline, prints colored report at end of each command. |
| `parser.js` | Language detection by extension. Defines the adapter contract (`{imports, exports, gaps, meta}`). Shared utilities: `lineAt()`, `resolveImport()`, `resolveAlias()`. |

### `src/brownfield/engine/` — Graph Construction

| Module | Purpose |
|--------|---------|
| `graph.js` | Orchestrates the full build: collect files → dispatch to adapters → merge → compute `importedBy` → write to SQLite + JSON. |
| `store.js` | SQLite wrapper (`better-sqlite3`). Tables: `nodes`, `edges`, `symbols`. Falls back to in-memory mock if native bindings fail. |
| `cache.js` | SHA1-based incremental cache. Only re-parses files whose hash changed since last run. |
| `symbol-index.js` | Reverse map: `symbolName → {file, kind, lineStart}`. Used by call-graph and blast-radius lookups. |
| `calls-extractor.js` | Extracts actual function call edges from source. Matches call patterns against the symbol index. |

### `src/brownfield/adapters/` — Language Parsers

Every adapter receives `(filePath, rootDir, aliases)` and returns:

```js
{
  file: '/abs/path',
  lang: 'typescript',
  imports: ['/resolved/path/a', '/resolved/path/b'],
  exports: ['functionName', 'ClassName'],
  gaps: [{ type: 'dynamic-require', pattern: "require(variable)" }],
  meta: { isBarrel: false, isController: true, framework: 'next' }
}
```

| Adapter | Languages |
|---------|-----------|
| `typescript.js` | `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs` |
| `go.js` | `.go` — resolves via `go.mod` module path |
| `python.js` | `.py` — handles relative imports |
| `swift.js` | `.swift` — detects iOS metadata (TabBar, Firebase) |
| `kotlin.js` | `.kt` — detects Android patterns |
| `graphql.js` | `.graphql`, `.gql` |
| `ruby.js` | `.rb` — resolves Gemfile deps |
| `java.js` | `.java` |
| `php.js` | `.php` |
| `csharp.js` | `.cs` |
| `c.js` | `.c`, `.h`, `.cpp` |

### `src/brownfield/analysis/` — Graph Intelligence

These modules receive the complete node map and return structured analysis. No LLM involved except where noted.

| Module | What it computes |
|--------|-----------------|
| `blast-radius.js` | BFS from a file through `importedBy` edges. Returns `{count, direct, transitive, files, crossLang}`. |
| `safety-scorer.js` | 0–100 risk score. Factors: dependents, public contract, test coverage, git bug-fix commits, tech debt signal. |
| `dead-code.js` | Unused files (no importers, not an entry point) and orphaned exports. |
| `legacy-health.js` | God files (>15 exports), circular deps, unannotated dynamic patterns. |
| `drift.js` | Parses machine-readable boundary rules from `PLAN.md`, checks every edge in the graph against them. |
| `comment-intel.js` | Aggregates `TODO`/`FIXME`/`BUG` comments by directory. Optional LLM enrichment for `techDebt`, `isBizFeature`. |
| `flow-discovery.js` | Traces primary execution paths (entry → domain logic) by following import chains. |
| `feature-modules.js` | Ranks directories as business feature vs infrastructure based on external importers + naming. |
| `call-graph.js` | BFS through function call edges extracted by `calls-extractor.js`. |
| `api-surface.js` | Distinguishes exports used by other modules (public contract) from internal-only exports. |

### `src/brownfield/summarization/` — Documentation Generation

| Module | Output |
|--------|--------|
| `module-summarizer.js` | 1-sentence summary per file. LLM on high-risk files; structural fallback for utilities. Cached by `file+exports` hash. |
| `master-md.js` | `MASTER.md` — grouped by directory, includes risk score, blast radius, test coverage, git signals for every file. |
| `role-classifier.js` | Classifies each file: controller, service, hook, UI component, utility, config, test, etc. |
| `conflict-explainer.js` | Detects dependency conflicts (peer violations, version mismatches) and generates resolution steps. |
| `onboarding.js` | Interactive Q&A that generates a developer onboarding guide from the graph. |

### `src/brownfield/reasoning/` — LLM-Backed Planning

These always use Sonnet (never Haiku) because they produce strategic output.

| Module | What it does |
|--------|-------------|
| `refactor-planner.js` | Given a goal, produces a multi-step refactor plan with GIT-OS commit sequences and independent PR suggestions. Input is graph + summaries — never raw source. |
| `migration-strategy.js` | 3-phase migration plan (prepare → migrate → cleanup) using high-risk node summaries. |
| `test-generator.js` | Selects uncovered high-risk files (riskScore > 50, coverage < 30%), generates test files using Sonnet. |
| `master-qa.js` | QA pass over `MASTER.md` — flags summaries under 20 chars or containing generic phrases. |

### `src/brownfield/query/` — Codebase Q&A

`chat-engine.js` classifies every question with pure regex (zero LLM cost) and routes to a deterministic handler:

| Question type | Example | Handler |
|--------------|---------|---------|
| `symbol-blast` | "What calls `userService`?" | Symbol index lookup + BFS |
| `blast-radius` | "What breaks if I change `auth.ts`?" | BFS through `importedBy` |
| `summary-lookup` | "What does `payments/index.js` do?" | `summaries.json` lookup |
| `git-history` | "Who wrote the auth layer?" | `git log` via `git-history.js` |
| `path-traversal` | "How does a request reach `createOrder`?" | Call-graph BFS |
| `graph-filter` | "List all files with risk > 80" | In-memory filter |
| `synthesis` | Complex multi-step questions | Haiku, max 20-node subgraph |

### `src/brownfield/subagents/` — Gap Filling

`gap-filler.js` resolves dynamic patterns the static parser can't see:
- `dynamic-require` — `require(variable)`
- `dynamic-import` — `import(computed)`
- `event-emit` — EventEmitter patterns
- `global-inject` — globals assigned at runtime

Gap filling uses Haiku with a 50-token cap. Edges are only added if confidence ≥ 0.80. This is never triggered automatically — only by explicit `wednesday-skills fill-gaps`.

---

## SQLite Schema

```sql
CREATE TABLE nodes (
  file        TEXT PRIMARY KEY,
  lang        TEXT,
  exports     TEXT,   -- JSON array
  meta        TEXT,   -- JSON object
  riskScore   INTEGER,
  importedBy  TEXT    -- JSON array
);

CREATE TABLE edges (
  src   TEXT,
  dst   TEXT,
  PRIMARY KEY (src, dst)
);

CREATE TABLE symbols (
  name          TEXT,
  file          TEXT,
  kind          TEXT,   -- function | class | const | interface
  lineStart     INTEGER,
  qualifiedName TEXT,
  PRIMARY KEY (file, name)
);
```

---

## Risk Score Formula

```
riskScore = min(100,
  min(dependents, 50) × 1.2        +  // blast radius weight
  (isPublicContract ? 25 : 0)      +  // exported and imported by others
  (100 - testCoverage) × 0.15      +  // uncovered = riskier
  min(bugFixCommits × 3, 15)       +  // git history signal
  techDebtSignal                   +  // from comment-intel (0/2/7/15)
  bizFeatureSignal                    // 0–10 based on isBizFeature
)
```

Band mapping: `0–30` Low, `31–55` Medium, `56–80` High, `81–100` Critical.

---

## Data Flow: `wednesday-skills map`

```
collectFiles(rootDir)
  └─ walks /src, finds *.js *.ts *.go *.py etc.

parseFile() × N files
  └─ typescript.js | go.js | python.js | ...
  └─ returns {imports, exports, gaps, meta}

buildGraph()
  └─ resolves import paths to absolute paths
  └─ builds importedBy reverse index
  └─ flags isEntryPoint, isBarrel, isTest

writeGraph()
  └─ .wednesday/codebase/dep-graph.json  (for agent consumption)
  └─ .wednesday/graph.db                 (for direct SQL queries)

printReport()
  └─ file counts by language
  └─ token cost + dollar savings
```

## Data Flow: `wednesday-skills analyze`

```
map (above)
  └─ builds graph.db

comment-intel
  └─ aggregates TODO/FIXME across all files
  └─ optional LLM enrichment (Haiku)

git-history
  └─ counts bug-fix commits per file
  └─ identifies danger zones (high churn)

safety-scorer
  └─ computes riskScore for every node using all signals above

legacy-health
  └─ god files, circular deps, dead exports

Output: .wednesday/codebase/analysis/*.json
```

## Data Flow: `wednesday-skills summarize`

```
load graph.db + dep-graph.json

module-summarizer × N files
  └─ check cache (file hash + exports hash)
  └─ if cache miss AND high-risk: call Haiku
  └─ if low-risk: structural template from role-classifier

master-md
  └─ groups files by directory
  └─ writes per-file section: summary, risk, blast, git signals

master-qa
  └─ QA pass: flags short or generic summaries

Output: .wednesday/codebase/summaries.json
        .wednesday/codebase/MASTER.md
        .wednesday/codebase/GUIDE.md
```
