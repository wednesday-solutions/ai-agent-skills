# /brownfield-fix — Pre-Edit Risk Check

## Purpose
Run a risk assessment before editing any file in a brownfield codebase. Provides a risk card showing impact scope, danger zones, and safe-to-edit verdict.

## Trigger
- "Check the risk before I edit this"
- "What breaks if I change this file?"
- "Is this file safe to modify?"

Type: `/brownfield-fix <file-path>` (or leave empty to check currently open file)

---

## Steps

### 1. Resolve the target file path
If `$ARGUMENTS` is empty, assume the currently open file in the editor.
If `$ARGUMENTS` is a relative path, resolve it relative to the project root.

### 2. Query the file summary from DB
```javascript
const queries = require('./.wednesday/queries-loader.js'); // Loader helper
const fileSummary = queries.getFileSummary('.wednesday/graph.db', targetFile);

if (!fileSummary) {
  console.log('File not found in graph. Run /brownfield-map first.');
  return;
}
```

This single query returns:
- Risk score & band
- Git history (commits, bugs, age)
- Import counts (fan-in/fan-out)
- Blast radius (transitive dependents)
- Entry point info
- Circular dep membership
- Coverage gaps

### 3. Check for daemons and adapters
Daemons and adapters are included in the file summary from the DB:
- Daemon patterns (setInterval, cron, process.on) → recorded as `gap_type`
- Adapter references (database, HTTP, payment) → recorded in analysis

### 6. Build the risk card

**Format:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE: <relative-path>
RISK SCORE: <score>/100  [<band>]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPACT SCOPE
  Direct dependents:    <N> files
  Transitive affected:  <N> files
  
CONTRIBUTING FACTORS
  Bug fixes in history: <N>
  Total commits:        <N>
  File age:             <N> days
  Import fanout:        <N>
  Unresolved gaps:      <N>
  
DAEMONS & ADAPTERS
  <list or "None">
  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[If SAFE or MODERATE]
✓ Safe to edit. Low blast radius. <one-line summary>

[If RISKY]
⚠ HIGH RISK. Affects <N> files. Review these before committing:
  • <top impacted file 1>
  • <top impacted file 2>
  • <top impacted file 3>

[If CRITICAL]
🛑 CRITICAL. <reason>. Do NOT edit without:
  1. Talking to the maintainer
  2. Running full test suite
  3. Code review from <most recent author>
```

### 7. If risk is RISKY or CRITICAL
List top 5 transitive dependents by name (from blast-radius.json or compute manually).

---

## Fallback (no JSON files)

If `.wednesday/codebase/dep-graph.json` doesn't exist, use the graph database:

```bash
sqlite3 .wednesday/graph.db "
  SELECT risk_score, bug_fixes, total_commits, file_age 
  FROM files 
  WHERE file_path = ?
"
```

If both fail, advise the user to run `wednesday-skills map --full` first.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| File not in graph | "File not yet mapped. Run `wednesday-skills map --full` first." |
| File doesn't exist | "File not found on disk at <path>. Check spelling." |
| No JSON files, no DB | "Run `wednesday-skills map --full` to initialize analysis." |
| Graph coverage < 70% | Add caveat: "Risk is based on incomplete graph — actual impact may be higher." |

---

## Success Criteria

- [ ] Shows risk card in under 2 seconds
- [ ] Card is self-contained (dev doesn't need to open other docs)
- [ ] Verdict is actionable (dev knows whether to proceed, ask for review, or stop)
- [ ] Works without MCP (uses JSON files + bash queries)
- [ ] Graceful error messages if graph is missing
