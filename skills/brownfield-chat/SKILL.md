---
name: brownfield-chat
description: Natural-language Q&A across the full codebase. Use for multi-module questions, "what breaks if", git history, cross-cutting queries, and anything spanning more than one file. For a single-file lookup use brownfield-query instead.
permissions:
  allow:
    - Bash(wednesday-skills chat *)
    - Bash(git log *)
---

## When to use
- "What breaks if I change X?" (multi-file blast radius)
- "Who last touched auth.ts?" (git history)
- "What changed in the last 30 days?" (git diff summary)
- "Which files have no tests and high risk?" (graph filter)
- "Path from checkout to database" (path traversal)
- Any question spanning multiple modules or layers
- Single-file structural lookups (what does X export, who imports Y)
- A file shows gaps in dep-graph.json — run `wednesday-skills fill-gaps --file <file>` to resolve

## When NOT to use
- Architecture rules / boundary enforcement → use **brownfield-drift**

## What to do
1. Run `wednesday-skills chat "<question>"` via Bash tool
2. The engine classifies the question and routes to the right handler:
   - **git-history**: queries `git log` directly — zero LLM
   - **summary-lookup**: reads `summaries.json` — zero LLM
   - **blast-radius**: BFS traversal of `dep-graph.json` — zero LLM
   - **graph-filter**: filters nodes by criteria — zero LLM
   - **path-traversal**: BFS between two nodes — zero LLM
   - **git-diff**: reads `git log --since` — zero LLM
   - **synthesis**: Haiku on max 20-node subgraph — ~$0.005
3. Report the answer with its cited source
4. If answer says "Not mapped" — tell the dev to run `wednesday-skills fill-gaps`

## Example questions
```bash
wednesday-skills chat "what does tokenService do"
wednesday-skills chat "who last touched auth.ts"
wednesday-skills chat "what breaks if I change userService"
wednesday-skills chat "which files have no tests and risk above 70"
wednesday-skills chat "path from checkout to database"
wednesday-skills chat "what changed in the last 30 days"
wednesday-skills chat "which go files have the most dependents"
```

## Never
- Send the full dep-graph.json to any LLM — the engine handles subgraph extraction
- Answer from Claude training knowledge about this specific codebase
- Guess when graph data is missing — "Not mapped" is the correct answer
- Load more than 20 nodes into any LLM call
- Read raw source files (*.ts, *.go, etc.) to answer structural questions

## Source citations
Every answer includes its source:
- `dep-graph.json (BFS traversal)` — pure graph
- `summaries.json + dep-graph.json` — cached summaries
- `git log` — git history
- `Haiku on subgraph (max 20 nodes)` — AI synthesis
- `not-mapped` — data not available, tell dev to map or fill gaps
