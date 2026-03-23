---
name: onboard-dev-agent
description: Use when a dev is new to the project, asks for an overview, or wants to get oriented quickly. Fills graph gaps then runs a guided codebase interview.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
requires:
  - brownfield-gaps
  - brownfield-chat
permissions:
  allow:
    - Bash(wednesday-skills fill-gaps *)
    - Bash(wednesday-skills analyze *)
    - Bash(wednesday-skills chat *)
    - Bash(git log *)
---

# Dev Onboarding Agent

## When to use
- "I'm new to this project, where do I start?"
- "Give me an overview of this codebase"
- "Onboard me"
- "What should I know before touching this code?"

## What to do

1. **brownfield-gaps** — Before answering anything, check for high-risk files with low graph coverage:
   - Run `wednesday-skills fill-gaps --min-risk 60`
   - This ensures the graph is reliable for the onboarding session
   - Report any gaps that were filled

2. **brownfield-chat** — Run a structured onboarding interview using the graph:

   Answer each of these in order, citing sources:
   - "What does this project do?" — reads MASTER.md overview
   - "What are the main modules and what does each do?" — summaries.json
   - "What are the highest-risk files and why?" — dep-graph.json safety-scores
   - "What changed in the last 30 days?" — git log
   - "What are the architecture rules I must not break?" — PLAN.md boundaries or MASTER.md danger zones
   - "Which areas have low test coverage?" — dep-graph.json coverage data

3. Finish with: "Which area would you like to explore first?"

## Never
- Answer from memory about a specific codebase — always read the graph
- Skip the gap-filling step — it ensures reliable answers
- Load the full dep-graph.json — query only relevant nodes
