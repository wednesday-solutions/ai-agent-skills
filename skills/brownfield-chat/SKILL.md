---
name: brownfield-chat
description: Unified codebase Q&A — handles all structural, historical, and natural-language questions about a mapped codebase. Single file lookups, blast radius, daemons, adapters, git history, architecture overview, and anything spanning multiple modules. Use this for any codebase question.
permissions:
  allow:
    - Read(.wednesday/codebase/MASTER.md)
    - Read(.wednesday/codebase/summaries.json)
    - Read(.wednesday/codebase/dep-graph.json)
    - Read(.wednesday/codebase/analysis/*)
    - Bash(git log *)
    - Bash(git diff *)
---

## When to use

Any codebase question — single file or multi-module:
- "What does X do?" / "What is X responsible for?"
- "What does X import / who imports X?"
- "What breaks if I change X?" (blast radius)
- "What daemons / background processes exist?"
- "What external services / adapters are used?"
- "Which files are high-risk or have no tests?"
- "What changed in the last 30 days?"
- "Who last touched X?"
- "What is the architecture of this project?"
- "What needs to be mocked in tests?"

## Token-efficient decision tree

**Read the minimum source that answers the question. Stop as soon as you have the answer.**

```
Question                           → Read this (in order, stop when answered)
─────────────────────────────────────────────────────────────────────────────
Architecture / "what does this     → MASTER.md only
  project do?"

"What does module X do?"           → summaries.json → find X entry only
                                   → fallback: MASTER.md section for X

"What does X import?"              → dep-graph.json → nodes["X"] only
"Who imports X?"                     (never load the full file — read the
"What are X's exports?"              node entry and its direct edges)
"Risk score of X?"

"What breaks if I change X?"       → dep-graph.json → BFS from X via
                                     importedBy, depth ≤ 5, max 10 nodes

"What daemons / background         → analysis/daemons.json (small, purpose-built)
  processes exist?"

"What external services / adapters → analysis/adapters.json (small, purpose-built)
  are used?" / "What to mock?"

"Which files are high-risk?"       → analysis/safety-scores.json

"Dead code?"                       → analysis/dead-code.json

"Git history / who wrote X /       → Bash(git log) — only case needing Bash
  what changed recently?"
```

---

## How to answer — by question type

### Architecture / overview
1. `Read .wednesday/codebase/MASTER.md` — overview, flows, tech stack, danger zones
2. Do NOT read dep-graph.json for overview questions — MASTER.md has it all

### "What does X do?" (module summary)
1. `Read .wednesday/codebase/summaries.json`
2. Extract only the entry for the file/module in question
3. Report: summary + risk score + blast radius count
4. If not in summaries → search MASTER.md for the module section

### "What does X import / who imports X / what are X's exports / risk score?"
1. `Read .wednesday/codebase/dep-graph.json`
2. Extract ONLY `nodes["<file>"]` — do not read more than 5 nodes per answer
3. Report: `imports[]`, `importedBy[]`, `exports[]`, `riskScore`, `isEntryPoint`

### "What breaks if I change X?" (blast radius)
1. `Read .wednesday/codebase/dep-graph.json`
2. Start at `nodes["X"]`, BFS over `importedBy` (depth ≤ 5)
3. Report: direct dependents, transitive count, cross-language hits
4. Never load more than 10 nodes into context

### Daemons / "what background processes / event listeners / queues exist?"
1. `Read .wednesday/codebase/analysis/daemons.json`
2. Report `total` and `byKind` breakdown
3. Kinds: `event-listener`, `event-emitter`, `interval`, `timeout`, `queue-consumer`, `websocket-handler`, `cron-job`, `process-signal`
4. Show file + event + line for each

### Adapters / "what external services?" / "what needs mocking?"
1. `Read .wednesday/codebase/analysis/adapters.json`
2. Report `total` and `byKind` grouped by category → library → files
3. Categories: `database`, `http-client`, `cache`, `storage`, `email`, `payment`, `auth`, `message-queue`, `sms`, `push`, `monitoring`

### High-risk / untested files
1. `Read .wednesday/codebase/analysis/safety-scores.json`
2. Filter by score > threshold, sort descending
3. Report top 10 with score and file path

### Dead code
1. `Read .wednesday/codebase/analysis/dead-code.json`
2. Report deadFiles + unusedExports

### Git history / "who wrote X / what changed recently?"
1. `Bash(git log --follow --oneline -20 -- <file>)` for file history
2. `Bash(git log --since="30 days ago" --oneline)` for recent activity
3. This is the **only** question type that needs a Bash call

### Path traversal / "how does a request get from X to Y?"
1. `Read .wednesday/codebase/dep-graph.json`
2. BFS through `imports` edges from source toward target (depth ≤ 6)
3. Report the shortest path found

---

## Source citation

Always end with the source used:
- `MASTER.md` — architecture, tech stack, flows, danger zones
- `summaries.json` — module purpose
- `dep-graph.json` — structural relationships
- `daemons.json` — background processes
- `adapters.json` — external service boundaries
- `safety-scores.json` — risk ranking
- `dead-code.json` — unused files/exports
- `git log` — history/authorship
- `not-mapped` — data missing, tell dev to run `wednesday-skills map`

---

## Never
- Read raw source files (*.ts, *.js, *.go) to answer structural questions
- Load the full dep-graph.json for a single-file question — extract only the node
- Load more than 10 nodes per answer
- Answer from Claude training knowledge about this specific codebase
- Guess when graph data is missing — say "Not mapped" and suggest `wednesday-skills map`
- Call any CLI tool via Bash except `git log` / `git diff`
