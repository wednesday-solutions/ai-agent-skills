# /brownfield-map — Full Codebase Analysis

## Purpose
Run a complete brownfield analysis on the codebase and generate MASTER.md, summaries, risk scores, and all derived analytics.

## Trigger
- "Map the entire codebase"
- "Analyze this project"
- "Update codebase intelligence"

Type: `/brownfield-map [--full]`

---

## Steps

### 1. Validate environment
Check that the project root contains a recognizable project file:
- `package.json` (Node.js)
- `go.mod` (Go)
- `Podfile` or `Package.swift` (iOS/Swift)
- `setup.py` or `pyproject.toml` (Python)
- `Gemfile` (Ruby)

If none found, stop and suggest the current directory.

### 2. Check for API key (optional)
If `.wednesday/config.json` exists and has an OpenRouter API key, the map will use LLM enrichment.
If no key, the map proceeds with deterministic analysis only (no LLM summaries).

Output: "Running full analysis mode" or "API key not configured — skipping LLM enrichment"

### 3. Execute the map command

```bash
wednesday-skills map --full
```

Wait for completion. The script will:
- Parse all source files
- Build the dependency graph
- Compute risk scores for each file
- Detect daemons and adapters
- Find dead code
- Detect circular dependencies
- Create coverage gaps report
- Generate module summaries (with LLM if API key exists)
- Write `.wednesday/codebase/` directory with:
  - `MASTER.md` (main intelligence document)
  - `dep-graph.json` (full dependency graph)
  - `summaries.json` (module summaries)
  - `analysis/blast-radius.json` (transitive impacts)
  - `analysis/safety-scores.json` (risk scoring)
  - `analysis/dead-code.json` (unused files + exports)

### 4. Parse the output and report

After the command completes, query the DB for final stats:

```javascript
const queries = require('./.claude/query-helpers.js');
const stats = queries.getCodebaseStats();
const highRiskFiles = queries.getHighRiskFiles(minRisk = 60);
const deadCode = queries.getAllDeadCode();
const circularDeps = queries.getCircularDependencies();
const entryPoints = queries.getEntryPoints();
```

**If successful:**
```
✓ Mapping complete

FILES ANALYZED
  Total files:      <stats.totalFiles>
  Languages:        <stats.languages>
  Graph edges:      <stats.totalEdges>
  
FINDINGS
  High-risk files:  <highRiskFiles.length>
  Dead files:       <deadCode.totalDeadFiles>
  Circular deps:    <circularDeps.count>
  Entry points:     <entryPoints.length>
  
INTELLIGENCE
  Daemons detected: [From MASTER.md Background processes section]
  Adapters found:   [From MASTER.md External adapters section]
  
OUTPUT LOCATIONS
  📄 MASTER.md:           .wednesday/codebase/MASTER.md
  📊 Graph Database:      .wednesday/graph.db
  
Graph coverage: <stats.graphCoverage>%
Generate time: <duration>
```

**If failed:**
```
✗ Mapping failed

Error: <error message>

Troubleshooting:
  • Missing API key? Set OPENROUTER_API_KEY in .env
  • Parse error? Check .wednesday/codebase/analysis/comments-raw.md
  • Graph DB locked? Kill any existing wednesday-skills processes
  • Out of memory? Reduce codebase scope or run on a larger machine
```

### 5. Next steps

After a successful map, suggest:
```
Next steps:
  • Read .wednesday/codebase/MASTER.md for full intelligence
  • Use /brownfield-chat for Q&A
  • Use /brownfield-fix before editing any file
  • Use /brownfield-blast to see change impact
```

---

## Fallback (if command fails)

Check what went wrong:

```bash
# Check if wednesday-skills is installed
which wednesday-skills

# Check if graph DB is locked
lsof .wednesday/graph.db 2>/dev/null | grep -v "^COMMAND"

# Check parse errors
tail -50 .wednesday/codebase/analysis/comments-raw.md
```

Suggest running with `--verbose` flag for detailed output:
```bash
wednesday-skills map --full --verbose
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| wednesday-skills not installed | "Install via: npm install -g @wednesday-solutions-eng/ai-agent-skills" |
| Not in a project root | "Run this command in the project root (same directory as package.json)" |
| Parse error on specific file | "Run with --verbose to see which file failed" |
| Graph DB locked | "Kill existing processes: pkill -f 'wednesday-skills' && sleep 2" |
| API key expired | "Set a new OPENROUTER_API_KEY in .env" |
| Out of memory | "This codebase is large. Try running on a machine with >8GB RAM" |

---

## Success Criteria

- [ ] Completes without errors
- [ ] MASTER.md is generated and readable
- [ ] All .wednesday/codebase/ analysis files exist
- [ ] User receives actionable next steps
- [ ] Graceful error messages for common failures
- [ ] Works with or without API key
