---
name: brownfield-chat
description: Use when the dev asks any open-ended question about the codebase — who wrote something, what depends on what, what changed recently, what a module does, or any structural question in plain English.
---

## When to use
- Any "who", "what", "which", "when", "how many" question about the project
- Questions spanning multiple modules or layers
- Dev wants to explore the codebase without reading files
- "What breaks if I change X", "who last touched X", "which files have no tests"

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
