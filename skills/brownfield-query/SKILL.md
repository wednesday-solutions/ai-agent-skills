---
name: brownfield-query
description: Use when asked what a module does, what breaks if a file changes, what a dependency conflict means, or what the architecture of this codebase is.
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

## Tools
Use the Read tool to query specific fields from these files:
- `.wednesday/codebase/dep-graph.json` → `nodes["<file>"]`
- `.wednesday/codebase/summaries.json` → `["<file>"]`
- `.wednesday/codebase/MASTER.md` → full read
- `.wednesday/codebase/analysis/conflicts.json` → full read

## Do NOT use
Do not read raw source files (*.ts, *.js, *.go) to answer structural questions.
Do not load the entire dep-graph.json — read only the relevant node.
