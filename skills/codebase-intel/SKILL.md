---
name: codebase-intel
description: Unified codebase intelligence. Handles all questions about structure, logic, risk, and dependencies. Combines natural-language Q&A with deterministic lookups and pre-edit blast radius checks.
permissions:
  allow:
    - Bash(wednesday-skills query *)
    - Bash(wednesday-skills blast *)
    - Bash(wednesday-skills fill-gaps *)
    - Read(.wednesday/codebase/MASTER.md)
    - Bash(git log *)
    - Bash(git diff *)
---

# Codebase Intelligence Specialist

This skill provides a comprehensive understanding of the project's structure, intent, and risk. Use it for everything from high-level architecture questions to detailed impact analysis before editing code.

## When to use

### 1. Codebase Discovery & Q&A
- "What does `tokenService` do?" (Summaries)
- "Where is the payment logic located?" (Role/Path mapping)
- "Show me an overview of the architecture." (Stats & Entry points)
- "Who last touched this file?" (Git history)
- "Find circular dependencies or dead code." (Structural audit)

### 2. Risk Assessment (Before Editing)
- "Is it safe to change this function signature?"
- "What is the blast radius of this file?"
- "What will break if I delete this constant?"

### 3. Graph Maintenance
- If a query returns "not mapped" or coverage is low.
- If you notice missing dependencies in the graph.

---

## How to use — by task type

### 🔍 Discovery & Q&A
1. **File Summary**: `Bash(wednesday-skills query getFileSummary <file_path>)`
   - Returns: Role, Summary, Risk Score, and Blast Radius.
2. **Architecture Stats**: `Bash(wednesday-skills query getCodebaseStats)`
   - Use `getHighConfidenceEntryPoints` to identify the best starting files.
3. **Advanced Lookups**:
   - `Bash(wednesday-skills query getHighRiskFiles 70)` — find critical technical debt.
   - `Bash(wednesday-skills query getCircularDependencies)` — find architectural smells.
   - `Bash(wednesday-skills query getAllDeadCode)` — find unreachable modules.
4. **Context**: `Read .wednesday/codebase/MASTER.md` for danger zones and primary data flows.
5. **History**: `Bash(git log --follow --oneline -20 -- <file>)` for authorship.

### ⚠️ Pre-Edit Safety Check (Mandatory)
Before modifying any file, you MUST perform these checks:
1. **Check Risk**: `Bash(wednesday-skills query getFileSummary <file_path>)`
   - **Score 0–30**: Proceed directly.
   - **Score 31–60**: Inform dev of the risk, proceed with care.
   - **Score 61–80**: List direct dependents and transitive count; ask confirmation.
   - **Score 81–100**: **STOP**. Require explicit dev approval before touching.
2. **Blast Radius**: `Bash(wednesday-skills blast <file_path>::<symbol_optional>)`
   - Review direct/transitive callers. Use this for cross-language impact (Go/Py/JS).

### 🛠 Graph Maintenance & Gaps
If you hit "not mapped" or detect a missing link:
1. **Gap Check**: `Bash(sqlite3 .wednesday/graph.db "SELECT file_path, meta FROM nodes WHERE file_path LIKE '%<file>%'")`
   - Check `meta` for `gaps.eventEmitter`, `gaps.dynamic`, etc.
2. **Fill Gaps**: `Bash(wednesday-skills fill-gaps --file <file> --min-risk 50)`
   - *Rule*: Only edges with confidence > 0.70 are added automatically.
3. **Annotations**: If gaps persist, ask dev to add `// @wednesday-skills:connects-to <symbol> → <file>`.
4. **Refresh**: `Bash(wednesday-skills analyze --incremental)` after adding annotations.

---

## 🚫 Never
- **Guess**: If data is missing, report "Not mapped" and suggest `wednesday-skills map --full`.
- **Skip Checks**: Never edit a file with risk > 80 without explicit dev confirmation.
- **Token Bloat**: Do NOT read raw source files to answer structural questions.
- **Add Unreliable Edges**: Never manually add edges with confidence below 0.70.

## 📄 Source Citation
Always end with the source:
- `graph.db` — Structural/Summary data
- `MASTER.md` — Architectural context
- `git log` — History/Authorship
