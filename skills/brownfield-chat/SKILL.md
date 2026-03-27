---
name: brownfield-chat
description: Natural-language Q&A across the full codebase. Use for multi-module questions, "what breaks if", git history, cross-cutting queries, daemons (event emitters, timers, queues, WebSockets, cron jobs), adapters (database, HTTP clients, cache, storage, email, payment, auth), and anything spanning more than one file. For a single-file lookup use brownfield-query instead.
permissions:
  allow:
    - Read(.wednesday/codebase/dep-graph.json)
    - Read(.wednesday/codebase/summaries.json)
    - Read(.wednesday/codebase/MASTER.md)
    - Read(.wednesday/codebase/analysis/*)
    - Bash(git log *)
    - Bash(git diff *)
---

## When to use
- "What breaks if I change X?" (multi-file blast radius)
- "Who last touched auth.ts?" (git history)
- "What changed in the last 30 days?" (git diff summary)
- "Which files have no tests and high risk?" (graph filter)
- "What does tokenService do?" (summary lookup)
- "What does X import / who imports X?" (structural lookup)
- "What daemons exist in this codebase?" (background processes)
- "What event listeners / queues / cron jobs are there?" (daemons)
- "What external services does this project use?" (adapters)
- "What database / cache / payment adapters are used?" (adapters)
- "What needs to be mocked in tests?" (adapters + daemons)
- Any question spanning multiple modules or layers

## When NOT to use
- Architecture rules / boundary enforcement → use **brownfield-drift**
- About to edit a file → use **brownfield-fix** first

## How to answer — by question type

Answer ALL questions by reading pre-built files with the Read tool.
**Do NOT call `wednesday-skills chat` via Bash** — read the files directly to avoid opening a terminal.

### Summary / "what does X do?"
1. `Read .wednesday/codebase/summaries.json` → find the file entry
2. If not in summaries, `Read .wednesday/codebase/MASTER.md` → search for the file section
3. Report the summary + risk score + blast radius count

### Structural / "what does X import / who imports X?"
1. `Read .wednesday/codebase/dep-graph.json` → `nodes["<file>"]`
2. Report `imports[]`, `importedBy[]`, `exports[]`, `riskScore`, `isEntryPoint`

### Blast radius / "what breaks if I change X?"
1. `Read .wednesday/codebase/dep-graph.json`
2. BFS over `importedBy` starting from the target file (depth ≤ 5)
3. Report: direct dependents, transitive count, any cross-language hits

### Graph filter / "which files have risk > 80?"
1. `Read .wednesday/codebase/dep-graph.json` → iterate `nodes`
2. Filter by the requested criteria (riskScore, lang, isEntryPoint, etc.)
3. Return ranked list

### Git history / "who wrote X / what changed recently?"
1. `Bash(git log --follow --oneline -20 -- <file>)` for file history
2. `Bash(git log --since="30 days ago" --oneline)` for recent changes
3. Git history is the **only** case that needs a Bash call

### Path traversal / "how does a request reach X from Y?"
1. `Read .wednesday/codebase/dep-graph.json`
2. BFS through `imports` edges from source to target (depth ≤ 6)
3. Report the shortest path found

### Architecture overview
1. `Read .wednesday/codebase/MASTER.md` — entry points, primary flows, danger zones
2. `Read .wednesday/codebase/analysis/legacy-report.json` — god files, circular deps

### Daemons / "what background processes exist?" / "what event listeners are there?"
1. `Read .wednesday/codebase/analysis/daemons.json`
2. Report `total` count and `byKind` breakdown
3. Example kinds: `event-listener`, `interval`, `queue-consumer`, `websocket-handler`, `cron-job`, `process-signal`
4. Show file + event name + line number for each

### Adapters / "what external services are used?" / "what needs mocking?"
1. `Read .wednesday/codebase/analysis/adapters.json`
2. Report `total` count and `byKind` breakdown
3. Example kinds: `database`, `http-client`, `cache`, `storage`, `email`, `payment`, `auth`, `message-queue`
4. Group by kind → library → files for a clean summary

## Source citation
Always end your answer with the source used:
- `dep-graph.json` — structural answer
- `summaries.json` — cached summary
- `MASTER.md` — architecture / danger zone
- `daemons.json` — background processes, event listeners, timers
- `adapters.json` — external service boundaries
- `git log` — history / authorship
- `not-mapped` — data missing, tell dev to run `wednesday-skills map`

## Never
- Call `wednesday-skills chat` via Bash — read the files directly instead
- Send the full dep-graph.json to any LLM — read only the relevant nodes
- Answer from Claude training knowledge about this specific codebase
- Guess when graph data is missing — "Not mapped" is the correct answer
- Load more than 20 nodes into any LLM call
- Read raw source files (*.ts, *.go, etc.) to answer structural questions
