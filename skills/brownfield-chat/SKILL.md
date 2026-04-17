---
name: brownfield-chat
description: Natural-language Q&A across the full codebase. Use for multi-module questions, "what breaks if", git history, cross-cutting queries, and anything spanning more than one file. For a single-file lookup use brownfield-query instead.
permissions:
  allow:
    - Bash(wednesday-skills query *)
    - Read(.wednesday/codebase/MASTER.md)
    - Bash(git log *)
    - Bash(git diff *)
---

## When to use
- "What breaks if I change X?" (multi-file blast radius)
- "Who last touched auth.ts?" (git history)
- "What changed in the last 30 days?" (git diff summary)
- "Which files have no tests and high risk?" (graph filter)
- "What does tokenService do?" (summary lookup)
- Any question spanning multiple modules or layers

## How to answer — by question type

### Module Summary / "what does X do?"
1. `Bash(wednesday-skills query getFileSummary <file_path>)`
2. Report the summary + role + risk score + blast radius
3. If specific logic details are missing, `Read .wednesday/codebase/MASTER.md` for that file's section

### Blast radius / "what breaks if I change X?"
1. `Bash(wednesday-skills query getBlastRadius <file_path>)`
2. Report: direct dependents, transitive count, cross-language hits

### Graph Filter / "which files are high risk?"
1. `Bash(wednesday-skills query getHighRiskFiles 70)` (returns top 20 files > 70 risk)
2. Use `getFilesByBand risky` or `getFilesByRole Logic` for broader filters

### Dead Code / Circular Dependencies
1. `Bash(wednesday-skills query getAllDeadCode)`
2. `Bash(wednesday-skills query getCircularDependencies)`

### Git history / "who wrote X / what changed recently?"
1. `Bash(git log --follow --oneline -20 -- <file>)` for file history
2. `Bash(git log --since="30 days ago" --oneline)` for recent changes

### Architecture overview
1. `Bash(wednesday-skills query getCodebaseStats)` for high-level numbers
2. `Bash(wednesday-skills query getHighConfidenceEntryPoints)` to find where to start
3. `Read .wednesday/codebase/MASTER.md` — entry points, primary flows, danger zones

## Source citation
Always end your answer with the source used:
- `graph.db` — structural / summary answer (via query)
- `MASTER.md` — architecture / danger zone
- `git log` — history / authorship
- `not-mapped` — data missing, tell dev to run `wednesday-skills map --full`

## Never
- Read the massive `dep-graph.json` or `summaries.json` — these are legacy and consume too many tokens. Use `wednesday-skills query` instead.
- Guess when graph data is missing — "Not mapped" is the correct answer.
- Load more than 20 nodes into any LLM call.
- Read raw source files (*.ts, *.go, etc.) to answer structural questions.
