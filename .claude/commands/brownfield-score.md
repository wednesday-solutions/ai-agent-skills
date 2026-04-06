# /brownfield-score — Risk Score Breakdown

## Purpose
Detailed risk scoring breakdown for a specific file. Shows all contributing factors and project comparison.

## Trigger
- "Why is this file risky?"
- "Show me the risk breakdown for X"
- "How does X's risk score compare?"

Type: `/brownfield-score <file-path>`

---

## Steps

### 1. Resolve the target file
If `$ARGUMENTS` is empty, use currently open file.
Resolve relative paths to project root.
Verify file exists in graph.

### 2. Load file risk data from DB
```javascript
const queries = require('./.claude/query-helpers.js');
const fileSummary = queries.getFileSummary(targetFilePath);
```

Returns all contributing factors:
- riskScore (final 0-100 score), band
- bugFixCommits, totalCommits
- ageInDays (days since creation)
- importedByCount (fan-in)
- importCount (fan-out)
- hasTests (boolean)
- isCircularDep (boolean)

### 3. Compute the score formula
Use the risk scoring algorithm (from graph.js):
```
riskScore = min(100, 
  (min(importedByCount, 50) * 1.2)
  + (isPublicContract ? 25 : 0)
  + ((100 - testCoverage) * 0.15)
)
```

Break this down visually for the dev.

### 4. Determine the band
- 0-30: Safe
- 31-60: Moderate
- 61-79: Risky
- 80-100: Critical

### 5. Compare to project average
Read all risk scores from dep-graph.json.
Compute the median and average.

Example: "This file scores 72 (Risky). Project average is 45 (Moderate). This is in the top 15% most risky."

### 6. Build the scorecard

**Format:**

```markdown
# Risk Score — <file-path>

## Overall Score

**72 / 100** — RISKY ⚠️

This file is in the top 15% most risky files in the project.
Project average: 45 (Moderate)
Project median: 38 (Moderate)

---

## Contributing Factors

| Factor | Value | Weight | Impact |
|--------|-------|--------|--------|
| Files importing this | 18 | ×1.2 | 21.6 pts |
| Public contract | Yes | +25 | 25 pts |
| Missing test coverage | 40% | ×0.15 | 9 pts |
| Recent bug fixes | 4 | - | Flagged ⚠️ |
| Age | 800 days | - | Old, many changes |
| **TOTAL** | | | **72** |

---

## What This Means

### High fan-in (18 files depend on this)
Changes here affect <N> files. You cannot change the public API without coordinating with dependents.

### Low test coverage (40%)
Only 40% of this file is tested. Changes are risky.

### Recent bug fixes (4 in last 6 months)
This file is fragile. Has had bugs before.

### Old file (800 days)
Lots of history. Many people have touched it. Potential for hidden assumptions.

---

## Recommendation

**Before editing this file:**
1. Add tests for the code you're changing (current coverage is below project average of 65%)
2. Check all dependents in the dependency graph
3. Run full test suite — not just unit tests
4. Get code review from whoever last edited this file

**If you need to change the public API:**
- Notify all 18 dependent file owners
- Use a deprecation period (add `@deprecated` comment)
- Update all dependents in the same PR

---

## Comparison

| File | Score | Reason |
|------|-------|--------|
| <high-risk-file> | 88 | Core infrastructure, many dependents |
| **<this-file>** | **72** | **Your file** |
| <moderate-file> | 45 | Utility, lower impact |

Your file is riskier than <moderate-file> because it has higher fan-in.
Your file is safer than <high-risk-file> because it's not core infrastructure.
```

### 7. Give actionable next step

**If score < 40:**
"✓ Safe to edit. Low risk. Standard testing is sufficient."

**If score 40-60:**
"⚠ Moderate risk. Add tests before committing. Code review recommended."

**If score 60-80:**
"🛑 High risk. New tests required. Full test suite + code review mandatory. Notify dependents if API changes."

**If score > 80:**
"🛑 CRITICAL. Contact owner before editing. This is infrastructure code."

---

## Fallback (if DB query fails)

If the graph.db query fails, the codebase must be mapped first:

```bash
wednesday-skills map --full
```

Once mapped, the DB will be populated with:
- Risk scores computed from fanin/fanout
- Git history (commit counts, bug fix counts)
- File age (days since creation)
- Circular dependency membership
- Test coverage status

---

## Error Handling

| Situation | Action |
|-----------|--------|
| File not in graph | "File not yet mapped. Run `/brownfield-map`." |
| No test coverage data | "Coverage data not available. Use `npm run coverage` to generate." |
| File is very new | "File has little history. Risk score may be inaccurate after more changes." |
| File has 0 dependents | "This file is not imported by anything. Risk is low regardless of other factors." |

---

## Success Criteria

- [ ] Score breakdown is transparent (dev understands each component)
- [ ] Formula is shown visually
- [ ] Project comparison provides context
- [ ] Recommendation is specific and actionable
- [ ] Execution time < 1 second
- [ ] Works with or without coverage data
