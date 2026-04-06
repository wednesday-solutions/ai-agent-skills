# /brownfield-chat — Natural Language Q&A

## Purpose
Answer any structural, historical, or architectural question about the codebase without reading raw source files.

## Trigger
- "What does X do?"
- "How does data flow from A to B?"
- "What breaks if I change this file?"
- "Which files handle authentication?"
- "What's the relationship between X and Y?"

Type: `/brownfield-chat <question>`

---

## Steps

### 1. Understand the question
Parse the user's question to extract:
- **Entity**: which file, module, or pattern they're asking about (X, A, B, authentication, etc.)
- **Relationship type**: "what does", "how does", "what breaks", "which files", "relationship"
- **Scope**: single file, module, cross-module, or whole codebase

### 2. Search the codebase via DB
```javascript
const queries = require('./.claude/query-helpers.js');
const results = queries.searchFiles(entityName);
```

This returns top matching files with full context:
- file_path, summary, purpose
- role, riskScore, importedByCount, importCount
- blastRadius (transitive dependents)
- entryPointConfidence

Return top 5 matching files.

### 3. For detailed file context, load full summary
```javascript
const summary = queries.getFileSummary(dbPath, filePath);
```

Returns:
- filePath, lang, summary, purpose, primaryRole
- riskScore, band
- importedByCount, importCount (fan-in/fan-out)
- bugFixCommits, totalCommits
- isDeadFile, isCircularDep
- entryPointConfidence, dangerReason
- blastRadius (transitive impacts)

### 4. Answer the question

#### For "what does X do?"
Combine the file summary + purpose + role to answer in 2-3 sentences.
**Example:** "auth.js is an Entry file (confidence 85%) that validates user credentials and manages JWT tokens. Imported by 8 files (api.js, middleware, routes). Risk score: 45 (Moderate)."

#### For "how does data flow from A to B?"
Use the import graph from file summaries to trace paths.
If path exists: list it step-by-step.
If no direct path: show closest path or note that they're unrelated.

#### For "what breaks if I change X?"
Answer with the blastRadius from the file summary query.
**Example:** "Changing graph.js affects 34 files (transitive). Most critical: store.js (relies on query API), parser.js (relies on node structure). Risk level: CRITICAL."

#### For "which files handle X?"
Search for matching files and group by role using role classification.
**Example:** "Authentication is handled by: auth.js (Entry), middleware/auth-guard.js (Infra), adapters/jwt.js (Adapter)."

### 5. End with provenance
State which tool was used:
- "Source: graph.db query via query-helpers.js"

---

## Fallback (if graph.db missing)

If the graph.db doesn't exist, the codebase must be mapped first:

```bash
wednesday-skills map --full
```

Once mapped, the DB will contain:
- All file paths, summaries, and purposes
- Import/dependency relationships
- Risk scores and role classifications
- Blast radius (transitive impacts) for each file
- Cross-language dependencies

The query layer will then provide fast, semantic answers to all questions.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| No matching files found | "No files match '<entity>'. Did you mean one of: <suggestions>" |
| Entity is too broad ("what does the code do?") | "That's very broad. Can you narrow it down? Examples: 'what does auth.js do', 'how do routes reach the database'" |
| Graph has low coverage (<70%) | Add caveat: "Note: graph coverage is <X>%, so some relationships may be incomplete." |
| No path exists between A and B | "A and B are not directly connected. Closest path: A → C → B (3 hops)." |

---

## Success Criteria

- [ ] Answers correctly without reading raw source files
- [ ] Works with incomplete graphs (caveat is shown)
- [ ] Answers vary based on question type (what, how, which, why)
- [ ] All answers cite source (dep-graph, summaries, blast-radius)
- [ ] Execution time < 3 seconds
