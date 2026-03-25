# LLM Intelligence Opportunities — Brownfield Pipeline
*Where to add minimal-token LLM calls to improve signal quality across the full workflow*

---

## Guiding Principle

Every LLM call here follows one rule: **highest signal per token**. The pipeline already
collects rich structural data (dep-graph, comments, git history, blast radius, safety scores).
The LLM's job is to *interpret* that data in one or two sentences — not re-read source files.

Token budget tiers used in this report:

| Tier | Max tokens in/out | Use case |
|------|-------------------|----------|
| Nano | ~100 in / 20 out | Single label or score |
| Micro | ~300 in / 50 out | 1–2 sentence interpretation |
| Small | ~600 in / 150 out | Short paragraph or ranked list |
| Batch | N×micro in one call | Multiple modules in one request |

---

## Current LLM Usage

| Component | File | Current cost | Quality |
|-----------|------|-------------|---------|
| Module summaries | `module-summarizer.js` | ~70 in / 80 out per file | Good — cached by graph hash |
| Comment enrichment | `comment-intel.js` | ~300 in / 100 out per module | Good — runs once, agent-driven |
| Onboarding guide | `onboarding.js` | ~400 in / 350 out per session | Acceptable |
| SUMMARY.md narrative | `guide.js` | ~800 in / 400 out | Acceptable |
| Conflict explainer | `conflict-explainer.js` | Unknown | Unknown |

---

## Zero-Token Wins (Already Implemented / Data Available)

These use `commentIntel` already computed — no LLM calls:

| Signal | Source | Used in |
|--------|--------|---------|
| `isBizFeature` (LLM-enriched) | `comments.json` | `feature-modules.js` sort |
| `isBizFeature` (name heuristic) | `BIZ_PATTERNS` regex | `feature-modules.js` fallback |
| `techDebt` signal (+15/+7/+2) | `comments.json` | `safety-scorer.js` |
| Dead file risk annotation | `comments.json` | `dead-code.js` `riskByFile` |
| Reverse PRD | `comments.json` | `master-md.js` architecture section |
| Per-module purpose/ideas/debt | `comments.json` | `master-md.js` module headers |

---

## Improvements: Where to Add Minimal LLM

### 1. Module Summarizer — Feed Comment Intel Into Prompt
**File:** `src/brownfield/summarization/module-summarizer.js`
**Current:** Prompt has `file`, `lang`, `exports`, `importedBy`, `lastCommit` (~70 tokens)
**Problem:** Two generic sentences from structural data are often noise ("this module exports X")
**Fix:** When `commentIntel` has a `purpose` for this file's directory, skip LLM entirely and
use the purpose string directly. This eliminates ~30% of LLM calls with *better* output.

```
When intel.purpose exists:
  summary = intel.purpose  ← zero tokens, 1 sentence from developer comments
Else if intel.taggedCount > 3:
  add top 2 tagged comments to prompt ← richer context for same token budget
Else:
  current behaviour
```

**Savings:** ~30–40% fewer summarizer API calls. Better summaries where comments exist.

---

### 2. Dead Code — One-Shot Risk Narrative
**File:** `src/brownfield/analysis/dead-code.js` + MAP_REPORT renderer
**Current:** Dead files listed as a flat array with `risk: high/low/unknown`
**Problem:** "Why is this file dead?" is unanswered — dev doesn't know if it's safe to delete
**Fix:** Single **Batch/Small** call after dead-code detection:

```
Input (~400 tokens):
  "These files have no importers. For each, given its path + parent module context,
  classify: (a) probably unused, (b) probably feature-flagged/lazy-loaded, (c) recently
  extracted/renamed. One word answer per file."
  [list of dead files + their parent module isBizFeature + taggedCount]

Output (~80 tokens):
  { "src/auth/legacyToken.js": "renamed", "src/utils/oldFormat.js": "unused", ... }
```

One call covers all dead files. Adds a `classification` field to `riskByFile`.
Shown in MAP_REPORT dead-code table as: 🔴 high/renamed · 🟢 low/unused.

---

### 3. Circular Dependencies — Break-Point Suggestion
**File:** `src/brownfield/analysis/dead-code.js` → `findCircularDeps`
**Current:** Returns cycle array + generic fix: "Extract shared types to break the cycle"
**Problem:** Generic fix — doesn't say *which* specific edge to cut or *what* to extract
**Fix:** **Micro** call per cycle (only for cycles involving biz-feature modules):

```
Input (~250 tokens):
  "Circular dependency: A → B → C → A.
  Module purposes: A=<purpose>, B=<purpose>, C=<purpose>
  Which single import should be removed? Which direction? What should be extracted?
  Answer in 2 sentences."

Output (~60 tokens):
  "Remove the import of C from A — C depends on A's session state which belongs in A.
  Extract the shared type into a new types/session.ts file both can import."
```

Only run for cycles with `isBizFeature=true` modules — these are the dangerous ones.
Skip infra cycles (they're usually fine).

---

### 4. Stale Dependencies — Usage-Aware Upgrade Advice
**File:** `src/brownfield/analysis/stale-deps.js`
**Current:** Lists outdated packages with severity (major/minor). Zero LLM.
**Problem:** `react@17→18` is critical. `lodash@4.17.20→4.17.21` is trivial. Same "high" severity.
**Fix:** Cross-reference stale deps with dep-graph to find which biz-feature modules use each
stale dep. Then one **Small** call:

```
Input (~500 tokens):
  "Outdated packages + which modules use them:
   react@17 → used in: [auth, checkout, dashboard] (all isBizFeature=true)
   lodash@4.17.20 → used in: [utils] (isBizFeature=false)
  Rank upgrade priority. Flag breaking-change risk. 3 bullet points."

Output (~120 tokens):
  Prioritized upgrade list with breaking-change flags.
```

Result added to `stale-deps.json` as `upgradeAdvice` field.

---

### 5. Architecture Drift — Human-Readable Violation Explanation
**File:** `src/brownfield/analysis/drift.js` → `formatDriftReport`
**Current:** Fix strings are hardcoded templates: "Move logic behind an API boundary"
**Problem:** Generic — doesn't use knowledge of what the modules actually *do*
**Fix:** When `commentIntel` is available, **Micro** call per violation (max 3):

```
Input (~200 tokens):
  "Architecture violation: src/checkout/CartSummary.tsx imports from src/lib/db/client.ts
  checkout purpose: <intel.purpose>
  db/client purpose: <intel.purpose>
  Write one sentence: why this is a problem and what the fix should be."

Output (~40 tokens):
  "CartSummary bypasses the API layer to read cart totals directly from the DB,
  which will break when the DB layer is extracted to a microservice."
```

Only run on `high` severity violations. Replaces generic fix text in the drift report.

---

### 6. Onboarding — Use reversePrd as Context
**File:** `src/brownfield/summarization/onboarding.js`
**Current:** Prompt is `role + area + top 10 file summaries` (~400 tokens)
**Problem:** File summaries are structural ("exports X, used by Y") — weak onboarding context
**Fix:** Prepend `reversePrd` (already computed in commentIntel) to the prompt instead of
generic file summaries. This cuts input tokens ~40% *and* produces better output:

```
Before: 10 structural summaries × 40 tokens = 400 token input
After:  reversePrd (150 tokens) + top 3 biz-feature modules (90 tokens) = 240 token input
```

Also: if `commentIntel.enrichedAt` exists, skip the LLM call entirely for the "general"
role + "general" area combination — use the structural fallback with reversePrd injected.

---

### 7. GUIDE.md — Replace Generic Intro With reversePrd
**File:** `src/brownfield/summarization/guide.js`
**Current:** GUIDE.md intro is structural: lists entry points, file counts
**Problem:** No project context — "what does this codebase actually do?" is unanswered
**Fix:** Zero tokens. When `commentIntel.reversePrd` exists, inject it as the first section
of GUIDE.md under `## What this project does`. No LLM call needed.

```markdown
## What this project does
<reversePrd paragraph>
```

---

### 8. Module Summarizer — Batch Unsummarized Modules
**File:** `src/brownfield/summarization/module-summarizer.js`
**Current:** One API call per uncached module (sequential)
**Problem:** 50 new files = 50 API calls with round-trip latency
**Fix:** Batch up to 20 unsummarized modules per call using a **Batch** prompt:

```
Input (~600 tokens for 20 modules):
  "Write one sentence each for these modules. Format: FILE: sentence
   file1.js | exports: [x,y] | used by: 3 modules | last commit: fix auth timeout
   file2.ts | exports: [a]   | used by: 1 module  | last commit: add payment retry
   ..."

Output (~400 tokens):
  file1.js: Handles auth token refresh...
  file2.ts: Implements payment retry logic...
```

20× fewer API calls. Same total tokens. Much faster due to reduced round-trips.

---

### 9. Health Score Narrative — Single Batch Call
**Currently not implemented**

After the full map pipeline runs, a single **Small** call can produce a codebase health
paragraph that appears at the top of MAP_REPORT.md:

```
Input (~400 tokens):
  "Codebase stats:
   - 8 biz-feature modules, 12 infra modules
   - High debt modules: [auth (3 FIXME), checkout (2 BUG)]
   - Dead files: 4 (2 high-risk in biz modules, 2 safe in utils)
   - Circular deps: 2 (1 involving auth)
   - Safety scores: 3 files Critical, 8 High
  Write a 3-sentence codebase health summary for a senior engineer."

Output (~100 tokens):
  "The auth and checkout modules carry the most risk — both have open bug tags and
  high blast radius. Two dead files in biz-feature modules need investigation before
  deletion. Overall architecture drift is low with no PLAN.md boundary violations."
```

Run only during `wednesday-skills map` (full pipeline), not `--report-only`.

---

## Summary: Implementation Priority

| # | Improvement | Tier | Tokens saved vs. current | Impact |
|---|-------------|------|--------------------------|--------|
| 7 | GUIDE.md reversePrd injection | Zero | 0 new tokens | High — immediate |
| 1 | Skip summarizer when purpose exists | Zero | −30% summarizer calls | High |
| 6 | Onboarding uses reversePrd | Micro | −40% input tokens | Medium |
| 8 | Batch module summarization | Batch | −95% round-trips | Medium |
| 9 | Health score narrative | Small | New (400→100 tokens) | High |
| 2 | Dead code classification | Small | New (400 for all files) | Medium |
| 3 | Circular dep break-point | Micro | New (250/cycle, biz only) | Medium |
| 5 | Drift violation explanation | Micro | New (200/violation, max 3) | Medium |
| 4 | Stale deps upgrade advice | Small | New (500→120 tokens) | Low |

### Recommended implementation order:
1. **Items 7 + 1 + 6** — zero/near-zero cost, immediate quality improvement to GUIDE and onboarding
2. **Item 8** — batch summarizer cuts API calls dramatically on large codebases
3. **Item 9** — health narrative is the highest-value new LLM call in the pipeline
4. **Items 2 + 3** — actionable dead code and cycle fixes; run conditionally (only when data exists)
5. **Items 4 + 5** — lower priority, run only when specific commands invoked

---

## What NOT to Use LLM For

These are currently done without LLM and should stay that way:

- **Blast radius computation** — pure graph BFS, no interpretation needed
- **Dependency graph parsing** — deterministic static analysis
- **Architecture drift detection** — rule-based glob matching against PLAN.md
- **Stale dep version comparison** — semver math
- **Safety score computation** — formula-based, auditable
- **Dead file detection** — pure `importedBy.length === 0` check

LLM adds value only at the *interpretation* layer, not the *detection* layer.
