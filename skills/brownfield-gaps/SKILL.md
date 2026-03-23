---
name: brownfield-gaps
description: Use when a file has low graph coverage, contains unannotated dynamic patterns, or when the dev asks to improve codebase mapping on a specific file.
permissions:
  allow:
    - Bash(wednesday-skills fill-gaps *)
    - Bash(wednesday-skills analyze *)
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

## Tools
Use Bash tool to run:
- `wednesday-skills fill-gaps --file <file> --min-risk 50`
- `wednesday-skills analyze --incremental`
Use Read tool for:
- `.wednesday/codebase/dep-graph.json` — read `nodes["<file>"].gaps`

## Do NOT use
Do not read the full file source before running fill-gaps.
Do not run fill-gaps without --min-risk flag.
