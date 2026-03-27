---
name: brownfield-chat
description: Unified codebase Q&A — handles all structural, historical, and natural-language questions about a mapped codebase. Single file lookups, blast radius, daemons, adapters, git history, architecture overview, and anything spanning multiple modules. Use this for any codebase question.
permissions:
  allow:
    - Read(.wednesday/codebase/MASTER.md)
    - Read(.wednesday/codebase/analysis/daemons.json)
    - Read(.wednesday/codebase/analysis/adapters.json)
    - Read(.wednesday/codebase/analysis/dead-code.json)
    - Bash(sqlite3 .wednesday/graph.db *)
    - Bash(git log *)
    - Bash(git diff *)
---

## When to use

Any codebase question — single file or multi-module:
- "What does X do?" / "What is X responsible for?"
- "What does X import / who imports X?"
- "What breaks if I change X?" (blast radius)
- "What daemons / background processes exist?"
- "What external services / adapters are used?"
- "Which files are high-risk or have no tests?"
- "What changed in the last 30 days?"
- "Who last touched X?"
- "What is the architecture of this project?"
- "What needs to be mocked in tests?"
- "Show me all services / controllers / hooks"

## DB-first lookup strategy

**Always query the DB first. Only read JSON/MD files if the DB has no answer.**

The graph DB at `.wednesday/graph.db` has everything in one place:
- `nodes` — file path, lang, role, band, risk score, summary, exports, is_test, is_entry
- `edges` — imports and call relationships between files
- `symbols` — function/class definitions with signatures
- `daemons` — background processes, event listeners, timers
- `adapters` — external services (redis, stripe, prisma, etc.)

```
Question type                  → DB query first                      → Fallback
───────────────────────────────────────────────────────────────────────────────
Architecture / overview        → (skip DB, read MASTER.md directly)
"What does X do?"              → SELECT summary,role,band FROM nodes WHERE file_path LIKE '%X%'
"Who imports X?"               → SELECT source FROM edges WHERE target LIKE '%X%' AND kind='imports'
"What does X import?"          → SELECT target FROM edges WHERE source LIKE '%X%' AND kind='imports'
"What breaks if X changes?"    → recursive CTE blast radius query (see below)
"All services / controllers"   → SELECT file_path,summary FROM nodes WHERE role = 'service'
"High-risk files"              → SELECT file_path,summary,risk_score FROM nodes WHERE band='critical' OR band='risky' ORDER BY risk_score DESC LIMIT 10
"Dead code?"                   → Read analysis/dead-code.json (not in DB)
"Daemons / background jobs"    → SELECT file_path,kind,event FROM daemons
"What adapters / mocking?"     → SELECT file_path,kind,library FROM adapters
"Find files about payments"    → SELECT file_path,summary FROM nodes WHERE summary LIKE '%payment%' OR file_path LIKE '%payment%'
"Git history / who wrote X"    → Bash(git log) — only case needing git
```

---

## Exact queries by question type

### Architecture / overview
1. `Read .wednesday/codebase/MASTER.md` — health snapshot, flows, module map, tech stack
2. Do NOT query the DB for overview questions — MASTER.md has it all

### "What does X do?" (single file)
```sql
SELECT file_path, role, band, risk_score, summary, exports
FROM nodes
WHERE file_path LIKE '%X%'
LIMIT 3;
```
Report: role + band + summary + exports. If summary is empty, node was not mapped — suggest `wednesday-skills map`.

### "What does X import?" / "Who imports X?" / "Exports?"
```sql
-- Imports (what X depends on)
SELECT target FROM edges WHERE source = 'exact/path.js' AND kind = 'imports';

-- Importers (who depends on X)
SELECT source FROM edges WHERE target = 'exact/path.js' AND kind = 'imports';
```
Use exact path when known. Use `LIKE '%X%'` to find path first via nodes query.

### "What breaks if I change X?" (blast radius)
```sql
WITH RECURSIVE blast(file, depth) AS (
  SELECT target, 1 FROM edges WHERE source = 'path/to/X.js' AND kind = 'imports'
  UNION
  SELECT e.target, b.depth + 1 FROM edges e JOIN blast b ON e.source = b.file
  WHERE b.depth < 5
)
SELECT file, depth FROM blast ORDER BY depth;
```
Report: direct count at depth=1, transitive total, max depth reached.

### "All controllers / services / hooks / etc."
```sql
SELECT file_path, summary, risk_score, band
FROM nodes
WHERE role = 'service'   -- or 'controller', 'React hook', 'middleware', 'router', 'data model'
  AND is_test = 0
ORDER BY risk_score DESC;
```

### "High-risk / critical files"
```sql
SELECT file_path, role, summary, risk_score
FROM nodes
WHERE band IN ('critical', 'risky')
  AND is_test = 0
ORDER BY risk_score DESC
LIMIT 10;
```

### "Find files related to X topic"
```sql
SELECT file_path, role, summary, risk_score
FROM nodes
WHERE (summary LIKE '%X%' OR file_path LIKE '%X%')
  AND is_test = 0
ORDER BY risk_score DESC
LIMIT 10;
```

### "What daemons / background processes exist?"
```sql
SELECT file_path, kind, event, line FROM daemons ORDER BY kind;
```
Or for a specific file: `SELECT kind, event, line FROM daemons WHERE file_path LIKE '%X%'`

### "What external services / adapters?" / "What to mock?"
```sql
SELECT file_path, kind, library, line FROM adapters ORDER BY kind, library;
```
Or by category: `SELECT file_path, library FROM adapters WHERE kind = 'database'`

### "Dead code / unused exports"
1. `Read .wednesday/codebase/analysis/dead-code.json`
2. Report `deadFiles` count + `unusedExports` top entries

### "Git history / who wrote X / what changed recently?"
```bash
git log --follow --oneline -20 -- <file>
git log --since="30 days ago" --oneline
```
Only case that needs a Bash git call.

---

## How to run sqlite3 queries

```bash
sqlite3 .wednesday/graph.db "SELECT file_path, role, summary FROM nodes WHERE band='critical' ORDER BY risk_score DESC LIMIT 10"
```

Always use `-separator` or default pipe-separated output. For multi-line results use:
```bash
sqlite3 -column -header .wednesday/graph.db "SELECT ..."
```

---

## Source citation

Always end with which source answered the question:
- `graph.db nodes` — file metadata, role, summary, risk
- `graph.db edges` — import/call relationships
- `graph.db symbols` — function/class definitions
- `graph.db daemons` — background processes
- `graph.db adapters` — external service boundaries
- `MASTER.md` — architecture overview, flows, module map
- `dead-code.json` — unused files/exports
- `git log` — history/authorship
- `not-mapped` — data missing, tell dev to run `wednesday-skills map`

---

## Never
- Read raw source files (*.ts, *.js, *.go) to answer structural questions
- Load summaries.json or dep-graph.json — the DB has this data now
- Load more than 10 nodes into context per answer
- Answer from Claude training knowledge about this specific codebase
- Guess when graph data is missing — say "Not mapped" and suggest `wednesday-skills map`
- Call any CLI tool via Bash except `sqlite3`, `git log`, `git diff`
