---
name: module-audit-agent
description: Use when asked to audit a module, check its health, or assess whether it should be refactored. Runs structural query, risk check, and test generation automatically.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
requires:
  - brownfield-chat
  - brownfield-fix
permissions:
  allow:
    - Bash(wednesday-skills score *)
    - Bash(wednesday-skills blast *)
    - Bash(wednesday-skills gen-tests *)
---

# Module Audit Agent

## When to use
- "Audit this module"
- "Is it safe to refactor X?"
- "What is the health of this service?"
- "Should we rewrite X?"

## What to do

1. **In parallel:**
   - **brownfield-chat** — Read `dep-graph.json` and `summaries.json` for the target module. Report: what it does, its imports, what imports it, and any known conflicts.
   - **brownfield-fix** — Run `wednesday-skills score <module>` and `wednesday-skills blast <module>`. Report risk band and total dependent count.

2. Present the combined audit report:
   - Purpose summary (from summaries.json)
   - Risk score + band (0–30 low / 31–60 medium / 61–80 high / 81–100 critical)
   - Blast radius (dependent count, cross-language flagged separately)
   - Architecture violations or danger zone warnings (from MASTER.md)
   - Recommendation: proceed / review / senior sign-off / do not touch

3. **brownfield-tests** — Only run if coverage < 30% AND risk > 50:
   - Run `wednesday-skills gen-tests --file <module>`
   - Show generated test file to dev for review before writing

## Never
- Recommend refactoring a critical file (risk > 80) without flagging the blast radius
- Read raw source to answer structural questions — use graph only
- Auto-write test files without showing the dev first
