/**
 * 3B1 — Codebase chat engine
 * Zero-cost question classifier + graph-backed answer handlers.
 * Synthesis fallback uses Haiku on a max-20-node subgraph only.
 */

'use strict';

const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

// ── Question classifier ───────────────────────────────────────────────────────

/**
 * Classify question into handler type — pure pattern matching, zero LLM.
 * @param {string} question
 * @returns {string} handler type
 */
function classify(question) {
  const q = question.toLowerCase();
  if (/who wrote|who knows|last (modified|touched|changed) by|who (last touched|owns|authored)/.test(q)) return 'git-history';
  if (/what does .+ do|what is .+ (for|used for)|explain .+|describe .+|tell me about/.test(q)) return 'summary-lookup';
  if (/what (breaks|will break)|blast radius|dependents of|what depends on|what (imports|uses) .+/.test(q)) return 'blast-radius';
  if (/which (modules|files|functions|components|services)|list (all|files|modules)|find (all|files)|show (all|me all)/.test(q)) return 'graph-filter';
  if (/chain from|path from|how does .+ reach|route from|flow from .+ to|connection between/.test(q)) return 'path-traversal';
  if (/what changed|recent changes?|last \d+ days?|recently (modified|changed)|what.s new|commits? (since|in the last)/.test(q)) return 'git-diff';
  return 'synthesis';
}

// ── File finder (fuzzy match on graph node names) ─────────────────────────────

/**
 * Find a node in the graph matching a name fragment (case-insensitive).
 * Prefers exact basename match, then contains match.
 */
function findNode(nameFragment, nodes) {
  const needle = nameFragment.toLowerCase().replace(/['"]/g, '').trim();
  if (!needle) return null;

  // 1. Exact path match
  if (nodes[needle]) return needle;

  // 2. Exact basename match (without extension)
  for (const file of Object.keys(nodes)) {
    const base = path.basename(file, path.extname(file)).toLowerCase();
    if (base === needle) return file;
  }

  // 3. Contains match on basename
  const containsMatches = Object.keys(nodes).filter(f => {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    return base.includes(needle);
  });
  if (containsMatches.length === 1) return containsMatches[0];
  if (containsMatches.length > 1) {
    // Prefer shortest (most specific) name
    return containsMatches.sort((a, b) => a.length - b.length)[0];
  }

  // 4. Contains match on full path
  const pathMatches = Object.keys(nodes).filter(f => f.toLowerCase().includes(needle));
  if (pathMatches.length > 0) return pathMatches.sort((a, b) => a.length - b.length)[0];

  return null;
}

/**
 * Extract a file name fragment from a question.
 * Matches: "what does tokenService do" → "tokenService"
 */
function extractFileMention(question) {
  // Match common patterns like "what does X do", "what is X for", "what breaks if I change X"
  const patterns = [
    /what does ([a-zA-Z0-9._/-]+) do/i,
    /what is ([a-zA-Z0-9._/-]+) (for|used for)/i,
    /explain ([a-zA-Z0-9._/-]+)/i,
    /describe ([a-zA-Z0-9._/-]+)/i,
    /tell me about ([a-zA-Z0-9._/-]+)/i,
    /what (breaks|will break) if .+ (change|modify|edit|touch) ([a-zA-Z0-9._/-]+)/i,
    /blast radius (?:of|for) ([a-zA-Z0-9._/-]+)/i,
    /dependents of ([a-zA-Z0-9._/-]+)/i,
    /what (imports|uses|depends on) ([a-zA-Z0-9._/-]+)/i,
    /who (wrote|owns|authored|knows) ([a-zA-Z0-9._/-]+)/i,
    /who last (touched|modified|changed) ([a-zA-Z0-9._/-]+)/i,
  ];

  for (const pat of patterns) {
    const m = question.match(pat);
    if (m) {
      // Return last capture group
      return m[m.length - 1];
    }
  }

  // Fallback: find a word that looks like a code identifier (camelCase, PascalCase, has dot)
  const codeWordMatch = question.match(/\b([a-z][a-zA-Z0-9]*Service|[a-z][a-zA-Z0-9]*Controller|[a-z][a-zA-Z0-9]*Handler|[A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]+\.[jt]sx?)\b/);
  return codeWordMatch ? codeWordMatch[1] : null;
}

// ── Handler: git history ──────────────────────────────────────────────────────

function handleGitHistory(question, nodes, rootDir) {
  const mention = extractFileMention(question);
  const file = mention ? findNode(mention, nodes) : null;

  if (file) {
    try {
      const log = execSync(
        `git log --follow --format="%an <%ae> on %ad — %s" --date=short -10 -- "${file}"`,
        { cwd: rootDir, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();

      if (!log) return { answer: `No git history found for \`${file}\`.`, source: 'git log', file };

      const lines = log.split('\n').filter(Boolean);
      const authorCounts = {};
      for (const line of lines) {
        const m = line.match(/^(.+?) on /);
        if (m) authorCounts[m[1]] = (authorCounts[m[1]] || 0) + 1;
      }
      const topAuthor = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0];

      return {
        answer: [
          `**\`${file}\`** — git history (last 10 commits):`,
          '',
          ...lines.map(l => `- ${l}`),
          '',
          topAuthor ? `Primary author: **${topAuthor[0]}** (${topAuthor[1]} commits)` : '',
        ].filter(l => l !== undefined).join('\n'),
        source: 'git log',
        file,
      };
    } catch {
      return { answer: `Could not read git history for \`${file}\` — is this a git repo?`, source: 'git log', file };
    }
  }

  // No specific file — recent authors across codebase
  try {
    const log = execSync(
      'git log --format="%an" --since="90 days ago"',
      { cwd: rootDir, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    const counts = {};
    for (const line of log.split('\n').filter(Boolean)) {
      counts[line] = (counts[line] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return {
      answer: '**Top contributors (last 90 days):**\n\n' + sorted.map(([a, n]) => `- ${a} — ${n} commits`).join('\n'),
      source: 'git log',
    };
  } catch {
    return { answer: 'Could not read git history — is this a git repo?', source: 'git log' };
  }
}

// ── Handler: summary lookup ───────────────────────────────────────────────────

function handleSummaryLookup(question, nodes, summaries) {
  const mention = extractFileMention(question);
  const file = mention ? findNode(mention, nodes) : null;

  if (!file) {
    return {
      answer: `Could not identify which file you mean. Try: \`wednesday-skills chat "what does <filename> do"\``,
      source: 'not-mapped',
    };
  }

  const node = nodes[file];
  const summary = summaries[file];

  const lines = [
    `**\`${file}\`**`,
    '',
    summary ? summary : `*No LLM summary available — run \`wednesday-skills summarize\` to generate.*`,
    '',
    `**Stats:**`,
    `- Language: ${node.lang}`,
    `- Exports: ${node.exports.slice(0, 8).join(', ') || 'none'}`,
    `- Imported by: ${node.importedBy.length} files`,
    `- Risk score: ${node.riskScore}/100`,
    `- Gaps: ${node.gaps.length}`,
  ];

  if (node.importedBy.length > 0) {
    lines.push('', `**Top consumers:**`);
    node.importedBy.slice(0, 5).forEach(f => lines.push(`- \`${f}\``));
    if (node.importedBy.length > 5) lines.push(`- ...and ${node.importedBy.length - 5} more`);
  }

  return { answer: lines.join('\n'), source: 'summaries.json + dep-graph.json', file };
}

// ── Handler: blast radius ─────────────────────────────────────────────────────

function handleBlastRadius(question, nodes) {
  const mention = extractFileMention(question);
  const file = mention ? findNode(mention, nodes) : null;

  if (!file) {
    return {
      answer: `Could not identify which file you mean. Try: \`wednesday-skills chat "what breaks if I change <filename>"\``,
      source: 'not-mapped',
    };
  }

  // BFS from the file following importedBy edges
  const visited = new Set();
  const queue = [file];
  const direct = new Set();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = nodes[cur];
    if (!node) continue;
    for (const importer of node.importedBy) {
      if (!visited.has(importer)) {
        queue.push(importer);
        if (cur === file) direct.add(importer);
      }
    }
  }

  visited.delete(file); // don't count the file itself
  const allDeps = [...visited];

  const node = nodes[file];
  const lines = [
    `**Blast radius: \`${file}\`**`,
    '',
    `- Direct dependents: **${direct.size}**`,
    `- Total (transitive): **${allDeps.length}**`,
    `- Risk score: ${node?.riskScore || 0}/100`,
    '',
  ];

  if (allDeps.length === 0) {
    lines.push('Nothing depends on this file — safe to change without side-effects.');
  } else {
    lines.push('**Files that break if you change this:**');
    allDeps.slice(0, 20).forEach(f => {
      const isDirect = direct.has(f);
      lines.push(`- \`${f}\` ${isDirect ? '*(direct)*' : '*(transitive)*'}`);
    });
    if (allDeps.length > 20) lines.push(`- ...and ${allDeps.length - 20} more`);
  }

  return { answer: lines.join('\n'), source: 'dep-graph.json (BFS traversal)', file };
}

// ── Handler: graph filter ─────────────────────────────────────────────────────

/**
 * Parse criteria from natural language.
 * Examples:
 *   "no tests and risk above 70" → { maxCoverage: 30, minRisk: 70 }
 *   "high risk files"            → { minRisk: 61 }
 *   "critical risk"              → { minRisk: 81 }
 *   "dead code"                  → { isDead: true }
 *   "typescript files"           → { lang: 'typescript' }
 */
function parseCriteria(question) {
  const q = question.toLowerCase();
  const criteria = {};

  if (/no tests?|zero (test|coverage)|uncovered/.test(q)) criteria.maxCoverage = 30;
  if (/risk (above|over|greater than|>) (\d+)/.test(q)) criteria.minRisk = parseInt(q.match(/risk (above|over|greater than|>) (\d+)/)[2]);
  if (/risk (below|under|less than|<) (\d+)/.test(q)) criteria.maxRisk = parseInt(q.match(/risk (below|under|less than|<) (\d+)/)[2]);
  if (/critical|score (above|>) 80/.test(q)) criteria.minRisk = criteria.minRisk ?? 81;
  if (/high[ -]risk|score (above|>) 60/.test(q) && !criteria.minRisk) criteria.minRisk = 61;
  if (/dead code|unused files?|orphan/.test(q)) criteria.isDead = true;
  if (/circular (dep|import)/.test(q)) criteria.hasCycles = true;
  if (/\btypescript\b/.test(q)) criteria.lang = 'typescript';
  if (/\bjavascript\b/.test(q)) criteria.lang = 'javascript';
  if (/\bgo\b/.test(q)) criteria.lang = 'go';
  if (/\bgraphql\b/.test(q)) criteria.lang = 'graphql';
  if (/god file|too many exports/.test(q)) criteria.isGodFile = true;
  if (/(many|most) (importers?|dependents?)/.test(q)) criteria.minImporters = 10;

  return criteria;
}

function handleGraphFilter(question, nodes) {
  const criteria = parseCriteria(question);
  const TEST_RE = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/;

  // Build test coverage map
  const covered = new Set();
  for (const [file, node] of Object.entries(nodes)) {
    if (TEST_RE.test(file)) {
      for (const imp of node.imports) covered.add(imp);
    }
  }

  let results = Object.entries(nodes)
    .filter(([file, node]) => {
      if (TEST_RE.test(file)) return false; // exclude test files from results
      if (criteria.lang && node.lang !== criteria.lang) return false;
      if (criteria.minRisk !== undefined && node.riskScore < criteria.minRisk) return false;
      if (criteria.maxRisk !== undefined && node.riskScore > criteria.maxRisk) return false;
      if (criteria.maxCoverage !== undefined && covered.has(file)) return false;
      if (criteria.isDead !== undefined && node.importedBy.length > 0) return false;
      if (criteria.isGodFile !== undefined && node.exports.length < 15) return false;
      if (criteria.minImporters !== undefined && node.importedBy.length < criteria.minImporters) return false;
      return true;
    })
    .sort(([, a], [, b]) => b.riskScore - a.riskScore);

  if (results.length === 0) {
    return {
      answer: `No files match those criteria. Try broadening your search.`,
      source: 'dep-graph.json + analysis',
    };
  }

  const criteriaDesc = Object.entries(criteria).map(([k, v]) => `${k}: ${v}`).join(', ');

  const lines = [
    `**${results.length} file(s) matching: ${criteriaDesc || question}**`,
    '',
    '| File | Lang | Risk | Importers |',
    '|------|------|------|-----------|',
    ...results.slice(0, 30).map(([file, node]) =>
      `| \`${file}\` | ${node.lang} | ${node.riskScore} | ${node.importedBy.length} |`
    ),
  ];

  if (results.length > 30) lines.push(``, `> ...and ${results.length - 30} more.`);

  return { answer: lines.join('\n'), source: 'dep-graph.json (graph filter)', count: results.length };
}

// ── Handler: path traversal (BFS) ─────────────────────────────────────────────

function extractTwoFiles(question) {
  // "chain from X to Y", "path from X to Y", "flow from X to Y"
  const m = question.match(/(?:chain|path|flow|route|connection)\s+from\s+([a-zA-Z0-9._/-]+)\s+to\s+([a-zA-Z0-9._/-]+)/i);
  if (m) return [m[1], m[2]];
  // "how does X reach Y"
  const m2 = question.match(/how does ([a-zA-Z0-9._/-]+) reach ([a-zA-Z0-9._/-]+)/i);
  if (m2) return [m2[1], m2[2]];
  return [null, null];
}

function bfsPath(fromFile, toFile, nodes) {
  // BFS following imports (forward traversal)
  const visited = new Map(); // file → parent
  visited.set(fromFile, null);
  const queue = [fromFile];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === toFile) {
      // Reconstruct path
      const path_arr = [];
      let node = toFile;
      while (node !== null) {
        path_arr.unshift(node);
        node = visited.get(node);
      }
      return path_arr;
    }
    const nodeObj = nodes[cur];
    if (!nodeObj) continue;
    for (const imp of nodeObj.imports) {
      if (!visited.has(imp)) {
        visited.set(imp, cur);
        queue.push(imp);
      }
    }
  }
  return null;
}

function handlePathTraversal(question, nodes) {
  const [fromName, toName] = extractTwoFiles(question);

  if (!fromName || !toName) {
    return {
      answer: `Could not parse two files from your question. Try: \`wednesday-skills chat "path from <file1> to <file2>"\``,
      source: 'not-mapped',
    };
  }

  const fromFile = findNode(fromName, nodes);
  const toFile = findNode(toName, nodes);

  if (!fromFile) return { answer: `Could not find \`${fromName}\` in the graph.`, source: 'dep-graph.json' };
  if (!toFile) return { answer: `Could not find \`${toName}\` in the graph.`, source: 'dep-graph.json' };

  const pathResult = bfsPath(fromFile, toFile, nodes);

  if (!pathResult) {
    // Try reverse direction
    const reverse = bfsPath(toFile, fromFile, nodes);
    if (reverse) {
      return {
        answer: [
          `**No direct path from \`${fromFile}\` → \`${toFile}\`**`,
          '',
          `However, the reverse path exists (\`${toFile}\` → \`${fromFile}\`):`,
          '',
          ...reverse.map((f, i) => `${'  '.repeat(i)}\`${f}\``),
        ].join('\n'),
        source: 'dep-graph.json (BFS traversal)',
      };
    }
    return {
      answer: `No dependency path found between \`${fromFile}\` and \`${toFile}\`. They may be in separate subgraphs.`,
      source: 'dep-graph.json',
    };
  }

  const lines = [
    `**Path from \`${fromFile}\` → \`${toFile}\`** (${pathResult.length} hops):`,
    '',
    ...pathResult.map((f, i) => `${'  '.repeat(i)}→ \`${f}\``),
  ];

  return { answer: lines.join('\n'), source: 'dep-graph.json (BFS traversal)' };
}

// ── Handler: git diff ─────────────────────────────────────────────────────────

function handleGitDiff(question, nodes, rootDir) {
  // Extract number of days from question
  const daysMatch = question.match(/(\d+)\s*days?/i);
  const days = daysMatch ? parseInt(daysMatch[1]) : 30;

  try {
    const log = execSync(
      `git log --since="${days} days ago" --format="%h %ad %an — %s" --date=short`,
      { cwd: rootDir, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!log) {
      return { answer: `No commits in the last ${days} days.`, source: 'git log' };
    }

    const lines = log.split('\n').filter(Boolean);

    // Also find high-risk files changed in this period
    const changedFilesRaw = execSync(
      `git log --since="${days} days ago" --name-only --format="" `,
      { cwd: rootDir, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    const changedFiles = [...new Set(changedFilesRaw.split('\n').filter(Boolean))];
    const highRiskChanged = changedFiles
      .filter(f => nodes[f] && nodes[f].riskScore > 60)
      .sort((a, b) => (nodes[b]?.riskScore || 0) - (nodes[a]?.riskScore || 0))
      .slice(0, 10);

    const result = [
      `**Changes in the last ${days} days** (${lines.length} commits):`,
      '',
      ...lines.slice(0, 20).map(l => `- ${l}`),
    ];

    if (lines.length > 20) result.push(`- ...and ${lines.length - 20} more`);

    if (highRiskChanged.length > 0) {
      result.push('', `**High-risk files touched (score > 60):**`);
      highRiskChanged.forEach(f => result.push(`- \`${f}\` — risk: ${nodes[f].riskScore}`));
    }

    return { answer: result.join('\n'), source: 'git log' };
  } catch {
    return { answer: 'Could not read git history — is this a git repo?', source: 'git log' };
  }
}

// ── Handler: synthesis (Haiku fallback) ──────────────────────────────────────

/**
 * Extract the most relevant nodes for a question (max 20).
 * Strategy: find mentioned files + their direct neighbors.
 */
function extractRelevantNodes(question, nodes, summaries) {
  const mentionedFile = findNode(extractFileMention(question) || '', nodes);
  const relevant = new Map();

  // Start with mentioned file
  if (mentionedFile && nodes[mentionedFile]) {
    relevant.set(mentionedFile, nodes[mentionedFile]);
    // Add direct imports and importers (neighbors)
    for (const imp of nodes[mentionedFile].imports.slice(0, 5)) {
      if (nodes[imp]) relevant.set(imp, nodes[imp]);
    }
    for (const importer of nodes[mentionedFile].importedBy.slice(0, 5)) {
      if (nodes[importer]) relevant.set(importer, nodes[importer]);
    }
  }

  // If still few nodes, add top high-risk files
  if (relevant.size < 5) {
    Object.entries(nodes)
      .sort(([, a], [, b]) => b.riskScore - a.riskScore)
      .slice(0, 10)
      .forEach(([f, n]) => relevant.set(f, n));
  }

  // Build compact context (<200 tokens)
  const nodeContexts = [...relevant.entries()].slice(0, 20).map(([file, node]) => {
    const sum = summaries[file];
    return `${file} [${node.lang}] risk:${node.riskScore} importedBy:${node.importedBy.length}${sum ? ` — ${sum.slice(0, 80)}` : ''}`;
  });

  return nodeContexts.join('\n');
}

async function callHaiku(question, context, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      messages: [
        {
          role: 'user',
          content: `You are a codebase expert. Answer this question using ONLY the graph data below. If the answer isn't in the data, say "Not mapped — run wednesday-skills analyze to capture this information."

Graph data:
${context}

Question: ${question}

Answer concisely. Cite specific files from the graph data.`,
        },
      ],
      max_tokens: 300,
      temperature: 0,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/wednesday-solutions/ai-agent-skills',
        'X-Title': 'Wednesday Skills Chat',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content?.trim() || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function handleSynthesis(question, nodes, summaries, apiKey) {
  if (!apiKey) {
    return {
      answer: `This question requires synthesis across the graph. Set OPENROUTER_API_KEY to enable AI-powered answers.`,
      source: 'not-mapped',
    };
  }

  const context = extractRelevantNodes(question, nodes, summaries);

  try {
    const answer = await callHaiku(question, context, apiKey);
    return {
      answer: answer || 'Not mapped — could not extract an answer from the graph.',
      source: 'Haiku on subgraph (max 20 nodes)',
    };
  } catch (e) {
    return { answer: `Synthesis failed: ${e.message}`, source: 'error' };
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Answer a question about the codebase.
 * @param {string} question
 * @param {string} rootDir
 * @param {Object} graph - loaded dep-graph.json
 * @param {Object} summaries - loaded summaries.json
 * @param {string|null} apiKey - OpenRouter key (only needed for synthesis)
 * @returns {Promise<{answer: string, source: string, type: string}>}
 */
async function answerQuestion(question, rootDir, graph, summaries, apiKey) {
  const type = classify(question);
  const nodes = graph.nodes;
  let result;

  switch (type) {
    case 'git-history':
      result = handleGitHistory(question, nodes, rootDir);
      break;
    case 'summary-lookup':
      result = handleSummaryLookup(question, nodes, summaries);
      break;
    case 'blast-radius':
      result = handleBlastRadius(question, nodes);
      break;
    case 'graph-filter':
      result = handleGraphFilter(question, nodes);
      break;
    case 'path-traversal':
      result = handlePathTraversal(question, nodes);
      break;
    case 'git-diff':
      result = handleGitDiff(question, nodes, rootDir);
      break;
    default:
      result = await handleSynthesis(question, nodes, summaries, apiKey);
  }

  return { ...result, type };
}

module.exports = { answerQuestion, classify };
