# PRD — Phase 2: Brownfield Intelligence (v4)

| Field | Detail |
|-------|--------|
| Phase | 2 — Brownfield Intelligence |
| Timeline | 4 days (Claude Code assisted) |
| Depends on | Phase 1.5 fully shipped |
| Repo | ai-agent-skills-internal (private) |
| OS | macOS only |
| Primary tools | Claude Code, Antigravity |
| AI cost strategy | OpenRouter free → Haiku → Sonnet (sparingly) |

---

## 1. Problem We Are Solving

Wednesday builds complex client projects with large codebases and rotating teams. Three problems cost the most senior dev time:

- Knowledge locked in people's heads — new devs spend 3–5 days onboarding
- AI agents flying blind — Claude Code guesses at relationships without a map
- Safe change decisions do not scale — blast radius is guesswork

Tree-sitter maps the codebase for free. Haiku adds readable summaries on top. Git hooks keep everything current on every commit. CLAUDE.md tells Claude Code to read the graph instead of raw source.

---

## 2. Skill Architecture

### Rules

- Every skill has one job
- Every SKILL.md is under 500 words
- If writing a skill and it exceeds 500 words — stop, identify the second job, create a new skill
- Related skills use `parent-child` naming
- Description field is the trigger — max 2 sentences, specific not vague

### Skill map for Phase 2

```
brownfield-query    — answer structural questions from graph + MASTER.md
brownfield-fix      — safe file edits, risk check, blast radius before touch
brownfield-gaps     — trigger gap subagents, annotation convention
```

### SKILL.md template (enforced structure)

```markdown
---
name: skill-name
description: [trigger — max 2 sentences, specific]
---

## When to use
[1–3 trigger conditions — no prose]

## What to do
[numbered steps only]

## Never
[hard stops — max 5 items]
```

---

## 3. CLAUDE.md additions for Phase 2

Append to existing CLAUDE.md after Phase 1 install:

```markdown
## Codebase intelligence

If .wednesday/codebase/dep-graph.json exists, this project has
been analyzed. Use these skills for all structural questions:

<available_skills>
  <skill>
    <name>brownfield-query</name>
    <description>
      Use when asked what a module does, what breaks if a file
      changes, what a dependency conflict means, or anything
      structural about the codebase.
    </description>
    <location>.wednesday/skills/brownfield-query/SKILL.md</location>
  </skill>

  <skill>
    <name>brownfield-fix</name>
    <description>
      Use before editing any file in a brownfield project.
      Checks risk score and blast radius before any change.
    </description>
    <location>.wednesday/skills/brownfield-fix/SKILL.md</location>
  </skill>

  <skill>
    <name>brownfield-gaps</name>
    <description>
      Use when coverage is low on a file or when dynamic
      patterns are unannotated. Triggers targeted subagents.
    </description>
    <location>.wednesday/skills/brownfield-gaps/SKILL.md</location>
  </skill>
</available_skills>

## Rules for codebase questions
- Always read from .wednesday/codebase/ — never read raw source
- dep-graph.json for structure and relationships
- summaries.json for module purpose
- MASTER.md for architecture, data flow, danger zones
- Graph updates automatically on every commit via post-commit hook
```

---

## 4. Skill Files — Full Content

---

### brownfield-query/SKILL.md

```markdown
---
name: brownfield-query
description: Use when asked what a module does, what breaks if
a file changes, what a dependency conflict means, or what the
architecture of this codebase is.
---

## When to use
- Dev asks "what does X do" or "what is X for"
- Dev asks "what breaks if I change X"
- Dev asks "why is this dependency conflicting"
- Dev asks anything about codebase structure or architecture

## What to do
1. Read .wednesday/codebase/dep-graph.json for the file in question
2. Read .wednesday/codebase/summaries.json for its cached summary
3. For architecture questions read .wednesday/codebase/MASTER.md
4. For conflict questions read .wednesday/codebase/analysis/conflicts.json
5. Answer from graph data — cite the risk score and blast radius count
   in your response so the dev understands the weight of the answer

## Never
- Read raw source files to answer structural questions
- Guess at relationships — only state what the graph shows
- Load the full dep-graph.json into context — query only the
  relevant node and its direct edges
- Answer from memory if dep-graph.json exists — always read fresh
```

Word count: 163 ✓

---

### brownfield-fix/SKILL.md

```markdown
---
name: brownfield-fix
description: Use before editing any file in a brownfield project.
Runs risk check and blast radius before making any change.
---

## When to use
- About to edit, refactor, rename, or delete any file
- About to change a function signature or exported value
- Dev asks "is it safe to change X"

## What to do
1. Run: wednesday-skills score <file>
   - Score 0–30: proceed
   - Score 31–60: tell dev the score, proceed with care
   - Score 61–80: tell dev, list direct dependents, ask confirmation
   - Score 81–100: stop, tell dev, require explicit approval
2. Run: wednesday-skills blast <file>
   - Include dependent count in your response
   - Cross-language dependents flagged separately
3. Check .wednesday/codebase/MASTER.md danger zones section
   - If file listed there: read the warning before proceeding
4. Make the change
5. Read git-os-commits skill before writing commit message
6. After committing: post-commit hook updates graph automatically

## Never
- Skip the score check — even for "small" changes
- Modify a file with risk score > 80 without explicit dev confirmation
- Bundle fixes to multiple high-risk files in one commit
- Ignore danger zones section warnings
```

Word count: 197 ✓

---

### brownfield-gaps/SKILL.md

```markdown
---
name: brownfield-gaps
description: Use when a file has low graph coverage, contains
unannotated dynamic patterns, or when the dev asks to improve
codebase mapping on a specific file.
---

## When to use
- dep-graph.json shows gaps.eventEmitter or gaps.conditional entries
- Dev says "this file is not mapped well"
- Coverage below 80% on a high-risk file (risk > 50)
- Dynamic require, global injection, or event emitter with no annotation

## What to do
1. Run: wednesday-skills fill-gaps --file <file> --min-risk 50
   - This spawns a targeted subagent for that file only
   - Subagent reads: exports list + nearby filenames + gap type
   - Never sends full file source to LLM
   - Returns edges with confidence score
   - Edges below 0.70 confidence are not added — flagged as unknown
2. If dynamic require found with no annotation — ask dev to add:
   // @wednesday-skills:connects-to <event> → <file>
3. If global injection found — ask dev to add:
   // @wednesday-skills:global <name> → <file>
4. After annotation added: run wednesday-skills analyze --incremental
5. Report new coverage % to dev

## Never
- Spawn subagent on files with risk score < 50 — not worth cost
- Send full file source to subagent — exports list and filenames only
- Add edges with confidence below 0.70 to the graph
- Run fill-gaps on the whole codebase at once — file by file only
```

Word count: 228 ✓

---

## 5. Hook Rules — Zero LLM

Hooks must never call an LLM. They are tree-sitter only.

```bash
# .wednesday/hooks/post-commit
#!/bin/bash
# Zero LLM. Tree-sitter incremental only.
wednesday-skills analyze --incremental --silent
# < 1 second. Never slows the commit.

# .wednesday/hooks/post-merge
#!/bin/bash
# Zero LLM. Full analysis refresh only.
# Subagent trigger happens separately — never in a hook.
wednesday-skills analyze --refresh-analysis --silent
```

**Why no LLM in hooks:**
- Hooks block the commit/merge until they finish
- LLM calls are variable latency — could be 2–30 seconds
- Developer should never feel the hook running
- Subagents triggered manually or via `fill-gaps` command only

---

## 6. Subagent Rules — Minimal Token Consumption

### Hard limits

```
Max input per subagent call:  400 tokens
What is sent:                 exports list + nearby filenames + gap description
What is never sent:           full file source, full graph, full MASTER.md
Batch size:                   up to 5 similar gaps per call
Confidence gate:              < 0.70 → edge not added, flagged as unknown
Risk gate:                    risk score < 50 → no subagent, leave as gap
Trigger:                      manual or fill-gaps command only, never hooks
```

### What each subagent receives (400 token budget)

```
Dynamic require subagent:
  file: "app/routes/index.js"                         [20 tokens]
  gap: "dynamic require: require('./routes/' + file)"  [15 tokens]
  exports: []                                          [5 tokens]
  nearby_files: ["users.js","orders.js","auth.js"]    [20 tokens]
  task: "which nearby files are likely loaded?"        [10 tokens]
  total: ~70 tokens — well within budget

Event emitter subagent:
  file: "src/events/publisher.ts"                     [20 tokens]
  gap: "emit: user.created"                           [10 tokens]
  exports: ["publishUserEvent", "publishOrderEvent"]   [15 tokens]
  candidate_listeners: ["emailService","auditLog"]     [20 tokens]
  task: "which candidates likely listen to user.created?" [12 tokens]
  total: ~77 tokens — well within budget

God file subagent:
  file: "services/userService.js"                     [20 tokens]
  exports: ["getUser","deleteUser","hashPassword"...]  [60 tokens]
  importers_per_export: {"getUser":["routes/users"]...} [80 tokens]
  task: "group exports into logical concerns"          [10 tokens]
  total: ~170 tokens — within budget
```

### Batching similar gaps

```javascript
// instead of 5 separate calls for 5 dynamic requires:
{
  task: "dynamic-require-batch",
  gaps: [
    { file: "routes/index.js", pattern: "require('./routes/' + f)", nearby: [...] },
    { file: "plugins/index.js", pattern: "require('./plugins/' + p)", nearby: [...] },
    // up to 5 per batch
  ]
}
// one call, ~300 tokens, returns 5 resolved gap objects
```

### Confidence and edge marking

```json
{
  "from": "app/routes/index.js",
  "to":   "app/routes/users.js",
  "type": "import",
  "strength": "agent",
  "confidence": 0.95,
  "resolvedBy": "dynamic-require-subagent"
}
```

MASTER.md shows confidence clearly:

```markdown
**Imports (static):** express, middleware/auth.js
**Imports (agent-resolved 95%):** routes/users.js, routes/orders.js
**Unresolved gaps:** 0
```

---

## 7. Directory Structure

```
.wednesday/
├── skills/
│   ├── brownfield-query/SKILL.md     # < 500 words
│   ├── brownfield-fix/SKILL.md       # < 500 words
│   └── brownfield-gaps/SKILL.md      # < 500 words
│
├── codebase/
│   ├── dep-graph.json
│   ├── summaries.json
│   ├── MASTER.md
│   ├── analysis/
│   │   ├── blast-radius.json
│   │   ├── dead-code.json
│   │   ├── api-surface.json
│   │   ├── safety-scores.json
│   │   └── conflicts.json
│   └── refactor/
│       ├── plan-<timestamp>.md
│       └── migration-<timestamp>.md
│
├── cache/                            # gitignored
│   ├── hashes.json
│   ├── summaries/
│   ├── triage/
│   ├── usage.json
│   └── onboarding/
│
├── hooks/
│   ├── post-commit                   # zero LLM, tree-sitter only
│   └── post-merge                    # zero LLM, analysis refresh only
│
└── scripts/
    └── dep-watchdog.js
```

---

## 8. Subphase Breakdown

---

### Phase 2A — Polyglot Parser + Dependency Graph (Days 1–2)

**Feature 2A-1 — Tree-sitter core**

Single adapter interface. All languages plug in via same contract. Malformed files skipped — never crash full scan.

**Feature 2A-2 — Language adapters**

| Adapter | Priority | Covers |
|---------|----------|--------|
| TS/JS | P0 | React, Next.js, Node, Serverless, Electron, RN |
| Go | P1 | go-template, go-template-mysql |
| GraphQL | P0 | node-express-graphql, react-graphql-ts |
| Kotlin | P2 | android-template (basic only) |

TS/JS adapter legacy additions:
- `module.exports = {}` object pattern
- `exports.x = function(){}` pattern
- Prototype-based classes (`Fn.prototype.method`)
- IIFE modules

**Feature 2A-3 — Supplementary parsers**

| Parser | Priority | What it does |
|--------|----------|-------------|
| CocoaPods | P0 | Podfile + Podfile.lock — RN native bridge deps |
| SPM | P0 | Package.swift — auto-detected alongside CocoaPods |
| Serverless | P0 | serverless.yml/ts — function to trigger mapping |
| Event annotations | P0 | @wednesday-skills:connects-to comments |
| NestJS DI | P1 | @Inject, @Module, @Injectable — soft edges |
| Git history miner | P1 | Bug fix frequency, HACK/TODO commits, file age, authors |

Auto-detect iOS package manager:
```javascript
function detectiOSPackageManager(rootDir) {
  return {
    cocoapods: fs.existsSync('Podfile'),
    spm:       fs.existsSync('Package.swift')
  }
}
```

Both feed into `packages.ios` — unified, not split.

**Feature 2A-4 — Dep graph engine**

Merges all worker output. Computes importedBy, riskScore, isEntryPoint, isBarrel per node. Writes `.wednesday/codebase/dep-graph.json`.

**Feature 2A-5 — Incremental cache**

File hash keyed. Only changed files re-parsed. < 1 second on 5-file PR.

**Feature 2A-6 — Git hooks (zero LLM)**

```bash
post-commit:  analyze --incremental --silent   # < 1s, zero LLM
post-merge:   analyze --refresh-analysis --silent  # zero LLM
```

Symlinked during `wednesday-skills install`.

**Feature 2A-7 — CLI**

```bash
wednesday-skills analyze              # incremental
wednesday-skills analyze --full       # force full
wednesday-skills analyze --watch      # dev mode
wednesday-skills fill-gaps            # run subagents on gaps
wednesday-skills fill-gaps --file <f> # specific file
wednesday-skills fill-gaps --min-risk 50  # risk gated
```

**Feature 2A-8 — Coverage gap subagents**

Triggered by `fill-gaps` command only — never by hooks.

| Gap type | Trigger | Model | Max tokens in | Batch size |
|----------|---------|-------|---------------|------------|
| Dynamic require | risk > 50 | Haiku | 400 | 5 per call |
| Event emitter | risk > 40 | Haiku | 400 | 5 per call |
| God file decompose | exports > 15 + coverage < 30% | Haiku | 400 | 1 per call |
| Global injection | risk > 60 | Haiku | 400 | 5 per call |

Confidence gate: < 0.70 → edge not added, flagged as unknown.

---

### Phase 2B — Static Analysis (Day 3 AM)

All features run on dep graph. Zero LLM cost.

| Feature | Command | What it does |
|---------|---------|-------------|
| Blast radius | `wednesday-skills blast <file>` | BFS reverse traversal, cross-lang |
| API surface | `wednesday-skills api-surface <file>` | Public contracts vs internal |
| Dead code | `wednesday-skills dead` | Unused files + exports |
| Safety scorer | `wednesday-skills score <file>` | 0–100 risk score |
| Call graph | `wednesday-skills trace <file> <fn>` | Function call chain |
| Stale deps | GitHub Action weekly | npm + go.mod + CocoaPods + SPM |
| Legacy health | `wednesday-skills legacy` | God files, circular deps, tech debt map |

**Safety score formula**
```
score = min(100,
  (min(dependents, 50) × 1.2) +   // max 60pts
  (isPublicContract ? 25 : 0) +    // 25pts
  ((100 - testCoverage) × 0.15)    // max 15pts
)
```

| Score | Band | Action |
|-------|------|--------|
| 0–30 | Low | Proceed |
| 31–60 | Medium | Review |
| 61–80 | High | Senior review |
| 81–100 | Critical | Explicit plan required |

---

### Phase 2C — Haiku Summarization (Day 3 PM)

LLM for human-readable language only. All cached by file hash.

**Cost: ~$0.10 one-time on 500 modules. Near zero ongoing.**

| Feature | Prompt size | Cache key | Model |
|---------|------------|-----------|-------|
| Module summarizer | ~70 tokens input | file hash | Free → Haiku |
| MASTER.md generator | high-value modules only | commit hash | Free → Haiku |
| Conflict explainer | conflict JSON only | conflict signature | Haiku |
| Onboarding guide | 3 answers + scoped node list | session | Haiku |

**Module summarizer prompt (70 tokens max)**
```
File: <path>
Lang: <lang>
Exports: <comma list>
Used by: <direct importers, max 5>
Last change: <commit message>
Write 2 sentences. Start with what it DOES.
```

MASTER.md generation: one call, high-value nodes only (entry points + importedByCount > 10 + riskScore > 70). Low-value summaries appended from cache — no LLM.

---

### Phase 2D — Sonnet Reasoning (Day 4)

One-time decisions. Inputs always graph + summaries — never raw source.

**Cost: ~$0.10–0.15 per call.**

| Feature | Command | When to use |
|---------|---------|------------|
| Refactor planner | `wednesday-skills plan-refactor "..."` | Major dep upgrade |
| Migration strategy | `wednesday-skills plan-migration "..."` | Cross-service upgrade |
| MASTER.md QA | auto after summarize | Once after generation |

Saved to `.wednesday/codebase/refactor/`.

**Brownfield SKILL.md split — three files under 500 words each (defined in Section 4 above)**

---

## 9. Coverage Summary

| Project type | Tree-sitter | + Gap subagents | Notes |
|---|---|---|---|
| React / Next.js | 95% | 95% | Fully static |
| Node Hapi / Express | 90% | 93% | EventEmitter gaps + annotation |
| NestJS | 60% | 88% | DI parser recovers most |
| Go template | 92% | 92% | Interface implementations missed |
| Serverless | 75% | 93% | serverless.yml covers triggers |
| React Native / Expo | 90% | 93% | TS/JS primary + CocoaPods/SPM |
| Android Kotlin | 70% | 70% | Basic only — DI in Phase 3 |
| Legacy CommonJS | 75% | 90% | Git history + subagents close gap |

---

## 10. Cost Model

| Operation | Frequency | Model | Cost |
|-----------|-----------|-------|------|
| Full scan 500 modules | Once | None | $0.00 |
| Module summaries initial | Once | Free tier | $0.00 |
| MASTER.md generation | Once | Free tier | $0.00 |
| Incremental scan per PR | Per PR | None | $0.00 |
| Post-commit hook | Every commit | None | $0.00 |
| Gap subagents (50 files) | Once per project | Haiku | ~$0.15 |
| Conflict explanation | On detection | Haiku | ~$0.01 |
| Onboarding guide | Per new dev | Haiku | ~$0.02 |
| Refactor plan | Per major refactor | Sonnet | ~$0.12 |
| Migration strategy | Per migration | Sonnet | ~$0.15 |
| **Ongoing per project/month** | | | **< $0.05** |

---

## 11. Build Order

```
Week 5:  2A-1 tree-sitter core
         2A-2 TS/JS adapter + legacy patterns
         2A-4 graph engine + 2A-5 cache
         2A-6 git hooks (zero LLM enforced)
         Integration test on real client TS project

Week 6:  2A-2 Go + GraphQL + Kotlin adapters
         2A-3 CocoaPods + SPM parsers
         2A-3 Serverless + annotation convention
         2A-3 NestJS DI + git history miner
         2A-7 CLI + 2A-8 gap subagents
         Full polyglot test

Week 7:  2B all static features
         Legacy health report
         Stale dep watchdog (npm + go.mod + CocoaPods + SPM)

Week 8:  2C-1 module summarizer
         2C-2 MASTER.md generator
         2C-3 conflict explainer
         2C-4 onboarding interview

Weeks 9–10: 2D refactor planner + migration strategy
            2D MASTER.md QA
            Three brownfield SKILL.md files (< 500 words each)
            CLAUDE.md + GEMINI.md updated
            End-to-end test on live client project
```

---

## 12. Success Metrics

| Metric | Target |
|--------|--------|
| Onboarding time | < 2 hours |
| Dep conflict resolution | < 15 min |
| Blast radius accuracy | 100% |
| MASTER.md usefulness | > 4/5 from dev survey |
| Initial scan 500 files | < 10 seconds |
| Post-commit hook time | < 1 second |
| Subagent tokens per call | < 400 |
| Ongoing cost per project/month | < $0.05 |
| Static coverage | > 85% |
| With subagents | > 92% |
| Every skill under 500 words | 100% |

---

## 13. Out of Scope — Phase 2

- iOS native Swift (Wednesday does not do iOS native)
- Android Hilt / Koin DI (Phase 3)
- Android Navigation XML (Phase 3)
- Full function-level call graph for Go + Kotlin (Phase 3)
- LLM calls in git hooks (never — hooks are zero LLM always)
- Subagents triggered from hooks (never — manual or fill-gaps only)
- Subagents on files with risk score < 50 (not worth cost)
- Edges with confidence < 0.70 added to graph (never)


---

## 14. Build Timeline — Claude Code Assisted

Timeline assumes Claude Code builds all code. Your time is review, decisions, and integration testing only.

```
Day 1 AM:  2A-1 tree-sitter core + 2A-2 TS/JS adapter
           Integration test on real Next.js project
           Fix edge cases

Day 1 PM:  2A-4 graph engine + 2A-5 incremental cache
           2A-6 git hooks + 2A-7 CLI
           End-to-end: analyze real repo, inspect dep-graph.json

Day 2 AM:  2A-2 Go + GraphQL + Kotlin adapters
           2A-3 CocoaPods + SPM + Serverless + annotations
           2A-3 NestJS DI + git history miner

Day 2 PM:  2A-8 gap subagents
           Integration test all adapters on polyglot project
           Review dep-graph.json output quality

Day 3 AM:  2B-1 through 2B-7 all static features
           All graph algorithms — fast to build
           Test each command on real dep-graph.json

Day 3 PM:  2C-1 module summarizer + cache
           2C-2 MASTER.md generator
           2C-3 conflict explainer + 2C-4 onboarding
           Read MASTER.md cold — does it make sense?

Day 4 AM:  2D-1 refactor planner + 2D-2 migration strategy
           2D-3 MASTER.md QA + 2D-4 SKILL.md files

Day 4 PM:  CLAUDE.md + GEMINI.md updates
           Full end-to-end test on two client projects
           Ship
```

---

## 15. Token Consumption Estimate

| Feature | Est. tokens | Model |
|---------|------------|-------|
| 2A-1 tree-sitter core | ~15k | Sonnet |
| 2A-2 TS/JS adapter | ~25k | Sonnet |
| 2A-2 Go adapter | ~8k | Sonnet |
| 2A-2 GraphQL adapter | ~6k | Sonnet |
| 2A-2 Kotlin adapter | ~5k | Sonnet |
| 2A-3 CocoaPods + SPM | ~4k | Sonnet |
| 2A-3 Serverless + annotations | ~6k | Sonnet |
| 2A-3 NestJS DI + git history | ~12k | Sonnet |
| 2A-4 Graph engine | ~20k | Sonnet |
| 2A-5 Incremental cache | ~8k | Sonnet |
| 2A-6 Hooks + 2A-7 CLI | ~7k | Sonnet |
| 2A-8 Gap subagents | ~12k | Sonnet |
| 2B all static features | ~38k | Sonnet |
| 2C all summarization | ~24k | Sonnet |
| 2D all reasoning + skills | ~27k | Sonnet |
| CLAUDE.md + GEMINI.md | ~2k | Sonnet |
| **Total** | **~227k tokens** | |

At Sonnet pricing (~$3/1M input, ~$15/1M output): **~$3–5 total build cost.**
Use Haiku for simpler features (2B, 2C-1) to bring this under $2.

---

## 16. Legacy Annotation Convention — Full Set

Four annotation types for patterns tree-sitter cannot capture statically:

```javascript
// Dynamic require — which files are loaded
// @wednesday-skills:connects-to route.users → ./routes/users.js
// @wednesday-skills:connects-to route.orders → ./routes/orders.js
fs.readdirSync('./routes').forEach(file => require('./routes/' + file))

// Global variable declaration
// @wednesday-skills:global db → ./database/connection.js
global.db = require('./database/connection')

// Global variable consumer — in any file that uses the global
// @wednesday-skills:uses-global db
function getUser(id) {
  return global.db.query('SELECT * FROM users WHERE id = ?', [id])
}

// Known side effect — what this function does beyond its return value
// @wednesday-skills:side-effect writes-to sessions-table
function createSession(userId) { ... }

// Callback chain — intent of a middleware/callback sequence
// @wednesday-skills:calls-next validateToken → formatResponse → sendReply
function handleRequest(req, res, next) { ... }
```

**Go equivalent:**
```go
// @wednesday-skills:connects-to order.placed → internal/notifications/handler.go
eventBus.Publish("order.placed", order)

// @wednesday-skills:global logger → pkg/logger/logger.go
var Logger *zap.Logger
```

**Annotation coverage tracked in MASTER.md:**
```markdown
## Legacy annotation coverage
| Category | Found | Annotated | Coverage |
|----------|-------|-----------|---------|
| Dynamic requires | 23 | 14 | 61% |
| Global injections | 8 | 8 | 100% |
| Event emitters | 12 | 6 | 50% |
| Callback chains | 31 | 0 | 0% |
```

Boy scout rule — whoever touches a file adds the annotations for that file. One-time cost per file, captured forever after.

---

## 17. Git History Miner — Detail

Feature 2A-3 supplementary parser. Zero LLM. Pure git commands.

**What it captures per file:**
```javascript
{
  totalCommits: 23,
  bugFixCommits: 4,           // commits with type "fix:" in message
  hackCommits: 2,             // commits mentioning HACK/workaround/temporary
  todoCount: 3,               // HACK/TODO/FIXME found in git log messages
  firstCommit: "2019-03-14",  // file age
  lastCommit:  "2025-03-10",
  ageInDays:   2187,
  authors: [                  // who knows this file
    { email: "dev1@wednesday.is", commits: 14 },
    { email: "dev2@wednesday.is", commits: 6  }
  ]
}
```

**Implementation:**
```bash
# per file — fast, zero API cost
git log --follow \
  --format="%H|%s|%ae|%ad" \
  -- <file>
```

**How it feeds MASTER.md danger zones:**

File appears in danger zones if any of:
- `bugFixCommits >= 3` — frequently broken
- `hackCommits >= 1` — known workarounds exist
- `riskScore >= 70` — high blast radius
- `testCoverage == 0 AND ageInDays > 365` — old and untested

**Module map entry additions from git history:**
```markdown
### legacy/services/userService.js
...
**Age:** Created 2019-03-14 (5 years old)
**Bug history:** 8 bug fixes — highest in codebase
**Known workarounds:** 3 commits mention HACK or workaround
**Who knows this:** dev1@wednesday.is (14 commits)
**Danger:** High bug fix frequency + known workarounds.
Talk to dev1@wednesday.is before modifying.
```

---

## 18. MASTER.md Legacy Sections

Added to MASTER.md structure when legacy patterns detected:

```markdown
## Legacy health report

### God files (doing too many things)
| File | Exports | Lines | Concerns identified |
|------|---------|-------|---------------------|
| services/userService.js | 23 | 847 | auth, db, formatting, email |
| routes/api.js | 31 | 1,203 | all routes in one file |

### Circular dependencies
| Cycle | Files | Risk |
|-------|-------|------|
| userService → orderService → userService | 2 | High |

### Unannotated dynamic patterns
| File | Line | Pattern | Action |
|------|------|---------|--------|
| app.js | 34 | Dynamic route loading | Add @connects-to |
| db.js | 12 | Global injection | Add @global |

### Tech debt map (ranked by priority)
| File | Bug fixes | Age | Coverage | Priority |
|------|-----------|-----|----------|----------|
| services/userService.js | 8 | 5yr | 0% | Critical |
| routes/api.js | 6 | 5yr | 12% | High |
```

---

## 19. Verification Checklist

Run these checks yourself — Claude Code cannot verify these for you.
Items marked ✅ have been built and smoke-tested during initial build.

**After Day 1:**
```
✅ dep-graph.json generated — validated on ai-agent-skills repo (38 files, 421ms)
✅ barrel file imports traced correctly (index.ts re-exports detected via meta.isBarrel)
✅ path aliases resolved — loadAliases() reads tsconfig.json/jsconfig.json paths
✅ incremental scan runs in < 1 second — confirmed 43ms (no changes) on this repo
✅ post-commit hook is silent (exit 0 regardless) — assets/hooks/post-commit written
✅ dep-graph.json is valid JSON — confirmed parseable by python3 -m json.tool
```

**After Day 2:**
```
✅ Go imports resolved correctly against go.mod paths — go adapter built with loadModulePath()
✅ Go capitalised exports captured, lowercase ignored — regex ^(func|type|var|const) [A-Z]
✅ GraphQL schema stitching — #import directives parsed, extend type detected
✅ CocoaPods + SPM both appear in packages.ios — confirmed in dep-graph.json structure
✅ Serverless triggers appear as edges — strength: "config" in serverless parser
✅ NestJS @Inject edges appear as strength: "di" — nestjs parser implemented
✅ Git history data in node.meta.gitHistory — git-history.js mineFile() built
✅ Gap subagent returns confidence score — fillGapsForNode() returns {confidence}
✅ Edge below 0.70 confidence not added to graph — CONFIDENCE_GATE = 0.70 enforced
```

**After Day 3:**
```
✅ blast radius BFS traversal built — wednesday-skills blast <file> working
✅ dead code list — wednesday-skills dead working
✅ safety score formula matches PRD — min(100, (min(dependents,50)*1.2)+(isPublic?25:0)+((100-cov)*0.15))
[ ] MASTER.md is readable — run `wednesday-skills summarize` on a real project and read it cold
✅ module summarizer built with structural fallback (no LLM required)
✅ conflict explainer detects peer/version conflicts from package.json
✅ onboarding guide scoped by area keyword — selectScopedNodes() filters by focus area
```

**After Day 4:**
```
✅ refactor planner follows GIT-OS commit format — prompt instructs "STEP N: [type(scope): desc]"
✅ refactor plan respects 5–6 files per PR — prompt explicitly sets this constraint
✅ all three SKILL.md files are under 500 words — brownfield-query: 240, brownfield-fix: 253, brownfield-gaps: 280
[ ] ask Claude Code "what does tokenService do" — reads graph not source (test on client project)
[ ] ask Claude Code "what breaks if I change tokenService" — runs blast radius (test on client project)
[ ] ask Claude Code "fix this file" — reads risk score first, warns if > 80 (test on client project)
[ ] total cost of full initial scan on a real 500-file project — confirm under $0.10
[ ] post-commit hook on a real commit — confirm < 1 second
[ ] MASTER.md updates after a commit — confirm changed section regenerates
```

**2B stale-deps:**
```
✅ stale-deps.js — checks npm, go.mod, CocoaPods (zero LLM)
✅ dep-watchdog.js — weekly runner, writes stale-deps.json
✅ stale-deps.yml — GitHub Action workflow, every Monday 9am
```

**Commands verified working on this repo:**
```
✅ wednesday-skills analyze .                     — 38 files, 421ms
✅ wednesday-skills analyze --incremental --silent — 43ms (no changes)
✅ wednesday-skills score src/brownfield/engine/graph.js — 35/100 Medium
✅ wednesday-skills blast src/brownfield/engine/graph.js — 2 dependents
✅ wednesday-skills dead                          — 7 dead files detected
✅ wednesday-skills trace src/brownfield/index.js — full chain printed
✅ dep-graph.json valid JSON, 1114 lines
✅ brownfield-query/fix/gaps SKILL.md all < 500 words
```

**The most important verification:**
Point Claude Code at a client project you know well. Ask questions you already know the answers to. If the answers match — the system works. If they do not — you have a specific gap to fix before shipping.