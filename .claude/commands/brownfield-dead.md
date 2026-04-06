# /brownfield-dead — Dead Code Finder

## Purpose
Identify all dead code in the codebase: unused files and unused exports.

## Trigger
- "Find dead code"
- "Show me what's not being used"
- "What can I delete safely?"

Type: `/brownfield-dead`

---

## Steps

### 1. Load dead code analysis from DB
```javascript
const queries = require('./.claude/query-helpers.js');
const deadCode = queries.getAllDeadCode();
```

Returns:
- deadFiles (array of files with 0 importers)
- unusedExports (array of exported symbols never imported)
- totalDeadFiles (count)
- totalUnusedExports (count)

Each file record includes:
- filePath, language, bytes, lastCommitDate, riskScore, lastAuthor
- For unused exports: file, exportName, exportType

### 2. Check graph coverage
If graph coverage < 80%, add a caveat:
> "⚠ Graph coverage is <X>%. Some 'dead' code may be dynamically imported or accessed via reflection. Verify before deleting."

### 3. Categorize dead files

**Safe to delete (no one owns them):**
- Generated files (`dist/`, `build/`, `.next/`)
- Test fixtures and mocks
- Legacy code without recent activity
- Empty `index.js` files with no imports

**Needs investigation (high risk):**
- Files with recent commits (< 30 days)
- Files with bug fixes in history
- Files in critical paths (even if unused)
- Files with risk score > 50

### 4. Build the report

**Format:**

```markdown
# Dead Code Report

**Total dead files:** <N>
**Total unused exports:** <N>
**Graph coverage:** <X>%

---

## Dead Files

### Safe to Delete

[If any exist]

| File | Size | Last Touch | Risk | Language |
|------|------|-----------|------|----------|
| <file> | <Bytes> | <Days ago> | Safe | <lang> |
| ... | ... | ... | ... | ... |

> These files are not imported by anything and don't pose risk.
> Safe to delete immediately.

### Needs Review

[If any exist]

| File | Last Commit | Risk | Reason | Author |
|------|------------|------|--------|--------|
| <file> | <date> | <score> | High risk flag | <who> |
| ... | ... | ... | ... | ... |

> These have either recent activity or high risk scores.
> Verify they're truly unused before deleting.

---

## Unused Exports

### By File

**<file-1>** (imported by: 0)
- `exportName1` — unused
- `exportName2` — unused

**<file-2>** (imported by: 0)
- `someFunction` — unused

[List all files with unused exports]

---

## Recommendations

### Delete Immediately
```bash
rm <file-1>
rm <file-2>
```

Update imports:
```bash
grep -r "import.*from.*<file>" --include="*.js" | wc -l
# Should be 0 before deleting
```

### Flag for Deprecation (Don't Delete Yet)
```javascript
/**
 * @deprecated Use newFunction() instead. Remove by [date].
 * This is scheduled for removal as it's not used internally.
 */
export function oldFunction() { ... }
```

### Keep (For Now)
- <file-path> — last commit was <date>, investigate before deleting

---

## Impact Summary

**Total debt to clean:** <N> files + <N> unused exports

**Estimated cleanup time:** <M> minutes
- <N> files to delete
- <N> exports to remove/deprecate
- <N> files to investigate

**Storage savings:** <KB> (if all deleted)

---

## Next Steps

1. Verify each "safe to delete" file one more time
2. Search codebase for dynamic imports (harder to detect):
   ```bash
   grep -r "require(.*variable.*)" --include="*.js"
   grep -r "import(.*variable.*)" --include="*.js"
   ```
3. Check configuration files for references
4. Delete verified dead files
5. Run full test suite to ensure nothing breaks
6. Commit with message: `chore: remove dead code (<N> files)`
```

---

## Caveats

### If Coverage < 80%

```
⚠ Graph coverage is <X>%. These files may have:
  • Dynamic imports: require(variableName), import(path)
  • Reflection-based access: obj[dynamicKey]
  • String-based requires in config files
  • Entry points not detected (bin/cli.js, etc.)

Before deleting, verify with:
  grep -r "<filename>" --include="*.js" --include="*.json"
```

### If File Uses Reflection

Files using `eval()`, `Function()`, or dynamic imports cannot be checked statically. Flag these:

```
⚠ <file> uses dynamic require/import. Cannot verify if truly dead.
```

### Cross-Language Dead Code

If importing Swift/Go code from JS:
- Dead code detection may miss cross-language references
- Verify in the native project before deleting

---

## Fallback (if DB query fails)

If the graph.db query fails, the codebase must be mapped first:

```bash
wednesday-skills map --full
```

Once mapped, the DB will be populated with dead code analysis. The query layer will automatically:
- Identify files with zero importers (deadFiles)
- Track unused exported symbols (unusedExports)
- Include risk scores and metadata for each dead file

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Dead code analysis not found | "Run `/brownfield-map` to generate dead code analysis." |
| Graph coverage too low | "Add caveat: results may be incomplete. Manual verification required." |
| File is entry point | "Do not delete — this is an entry point (even if no direct importers)." |
| File has side effects | "Do not delete — this file may execute on import (e.g., register handlers)." |
| Recent activity | "File was edited <N> days ago. Verify it's truly unused before deleting." |

---

## Success Criteria

- [ ] Dead files are accurately identified
- [ ] Unused exports are listed per file
- [ ] High-risk dead files are flagged for review
- [ ] Caveats about coverage are shown
- [ ] Deletion commands are copy-paste ready
- [ ] Safe vs. risky dead code are clearly separated
- [ ] Works with or without dead-code.json
