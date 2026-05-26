# /brownfield-blast — Blast Radius Report

## Purpose
Generate a detailed blast radius report showing all files affected if you change a given file.

## Trigger
- "Show me the blast radius of this file"
- "What happens if I change X?"
- "Who depends on this module?"

Type: `/brownfield-blast <file-path>`

---

## Steps

### 1. Resolve the target file
If `$ARGUMENTS` is empty, use the currently open file.
Resolve relative paths to project root.
Verify the file exists in the graph.

### 2. Load blast radius from DB
```javascript
const queries = require('./.claude/query-helpers.js');
const blastData = queries.getBlastRadius(targetFilePath);
```

Returns:
- count (total transitive dependents)
- direct (files that directly import this)
- transitive (all affected files at all depths)
- files (array with distances/hops)
- crossLang (cross-language dependencies)

### 3. Load file summary for context
```javascript
const summary = queries.getFileSummary(targetFilePath);
```

Provides:
- summary (1-line module purpose)
- primaryRole (Util, Logic, Infra, etc.)
- importedByCount (fan-in)
- riskScore, band
- dangerReason

### 4. Build the report

**Format:**

```markdown
# Blast Radius — <file-path>

## File Summary
[Summary from dep-graph]

**Role:** <role>  
**Risk Score:** <score>/100  
**Bug Fixes:** <count>  

---

## Direct Dependents
<N> files directly import this:
- <file 1>
- <file 2>
- ...

---

## Transitive Dependents
<N> files would be affected if this changes:
- <file 1> (distance: 1 hop)
- <file 2> (distance: 1 hop)
- <file 3> (distance: 2 hops)
- ...
[Show up to 20; note if more exist]

---

## Cross-Language Hits
[If any]
- <swift file> imports this JS file (iOS build may break)
- <go file> depends on exported JSON schema

---

## Recommended Action

[If transitive dependents < 5]
✓ Safe to change. Low blast radius. Run tests in dependent files.

[If transitive dependents 5-20]
⚠ Moderate impact. Affects <N> files. Ensure tests pass for:
  • <top 3 dependent files>

[If transitive dependents > 20]
🛑 CRITICAL impact. <N> files depend on this.
Before changing:
  1. Ensure changes are backwards compatible
  2. Update all dependent imports
  3. Run full test suite
  4. Notify team (@owner)
```

### 5. If cross-language hits exist
Flag them prominently — changing a JS file that's imported by Swift code can break the iOS build.

### 6. Note if any dependents are in danger zone
If any transitive dependent has risk score > 60, flag it:
> "⚠ Dependent `auth.js` is high-risk (score: 78). Changes here cascade through auth, which is already fragile."

---

## Fallback (if DB query fails)

If the graph.db query fails, the codebase must be mapped first:

```bash
wednesday-skills map --full
```

Once mapped, the DB will be populated and queries will work. If DB is locked, kill any running processes:

```bash
pkill -f 'wednesday-skills'
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| File not in graph | "File not yet mapped. Run `wednesday-skills map --full`." |
| File exists but has 0 dependents | "✓ This file is not imported by anything. Safe to delete or change freely." |
| Blast radius > 50% of codebase | "⚠ This is a core infrastructure file. Changes affect the entire system." |
| Cross-language hits detected | "⚠ WARNING: This file is imported by non-JS code (Swift/Go). Mobile build may break." |

---

## Success Criteria

- [ ] Report shows all dependents, not capped at a threshold
- [ ] Cross-language dependencies are flagged
- [ ] Recommended action matches impact level
- [ ] Works without blast-radius.json (fallback compute)
- [ ] Execution time < 2 seconds
- [ ] Developer can see the full picture in under 30 seconds
