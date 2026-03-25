---
name: brownfield-query
description: Deterministic lookups from dep-graph.json. Use for direct structural questions about a specific file or module — what it imports, what imports it, its risk score, its exports. For multi-module or natural-language questions use brownfield-chat instead.
---

> **Deprecated:** This skill has been merged into `brownfield-chat`, which handles all structural codebase questions including single-file lookups. Use `brownfield-chat` instead.

## When to use
- "What does `src/auth/token.js` export?"
- "What files import `userService`?"
- "What is the risk score for `db/queries.js`?"
- "Show me the direct dependencies of this specific file"
- You need a deterministic answer from one or two graph nodes

## When NOT to use
- Multi-module or cross-cutting questions → use **brownfield-chat**
- "What breaks if I change X" spanning many files → use **brownfield-chat**
- Architecture overview questions → use **brownfield-chat** or read MASTER.md

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

## Tools
Use the Read tool to query specific fields from these files:
- `.wednesday/codebase/dep-graph.json` → `nodes["<file>"]`
- `.wednesday/codebase/summaries.json` → `["<file>"]`
- `.wednesday/codebase/MASTER.md` → full read
- `.wednesday/codebase/analysis/conflicts.json` → full read

## Do NOT use
Do not read raw source files (*.ts, *.js, *.go) to answer structural questions.
Do not load the entire dep-graph.json — read only the relevant node.
