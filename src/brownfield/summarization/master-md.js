/**
 * 2C-2 — MASTER.md generator
 * One call for high-value nodes. Low-value appended from cache.
 * Writes .wednesday/codebase/MASTER.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Determine which nodes are "high-value" (get LLM treatment)
 */
function isHighValue(node) {
  return (
    node.isEntryPoint ||
    node.importedBy.length > 10 ||
    node.riskScore > 70
  );
}

/**
 * Generate MASTER.md content from graph + summaries
 */
async function generateMasterMd(graph, summaries, legacyReport, codebaseDir, apiKey) {
  const nodes = graph.nodes;
  const highValue = Object.values(nodes).filter(isHighValue);
  const allFiles = Object.entries(nodes);

  const lines = [];

  lines.push(`# Codebase MASTER.md`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Files: ${graph.stats.totalFiles} | Edges: ${graph.stats.totalEdges} | High-risk: ${graph.stats.highRiskFiles}`);
  lines.push('');

  // ── Architecture overview (Haiku one-shot) ────────────────────────────────
  lines.push('## Architecture overview');
  lines.push('');
  if (apiKey && highValue.length > 0) {
    const archSummary = await callHaikuArchitecture(highValue, graph.stats, apiKey);
    lines.push(archSummary || '*Analysis unavailable*');
  } else {
    lines.push(generateStructuralArchOverview(graph.stats, highValue));
  }
  lines.push('');

  // ── Entry points ──────────────────────────────────────────────────────────
  lines.push('## Entry points');
  lines.push('');
  const entries = Object.values(nodes).filter(n => n.isEntryPoint);
  if (entries.length === 0) {
    lines.push('*None detected*');
  } else {
    for (const node of entries) {
      lines.push(`- **${node.file}** — ${summaries[node.file] || 'entry point'}`);
    }
  }
  lines.push('');

  // ── Module map (high-value first) ─────────────────────────────────────────
  lines.push('## Module map');
  lines.push('');

  // High-value nodes
  for (const node of highValue) {
    lines.push(formatNodeSection(node, summaries[node.file] || '', nodes));
  }

  // Low-value nodes — condensed table
  const lowValue = allFiles.filter(([, n]) => !isHighValue(n) && !n.error);
  if (lowValue.length > 0) {
    lines.push('### Other modules');
    lines.push('');
    lines.push('| File | Summary |');
    lines.push('|------|---------|');
    for (const [file, node] of lowValue.slice(0, 100)) {
      const sum = (summaries[file] || '').split('.')[0];
      lines.push(`| ${file} | ${sum} |`);
    }
    lines.push('');
  }

  // ── Danger zones ──────────────────────────────────────────────────────────
  if (legacyReport?.dangerZones?.length > 0) {
    lines.push('## Danger zones');
    lines.push('');
    lines.push('⚠️ **Read these warnings before modifying these files.**');
    lines.push('');
    for (const dz of legacyReport.dangerZones) {
      lines.push(`### ${dz.file}`);
      lines.push(`**Danger:** ${dz.reason}`);
      lines.push(`**Who knows this:** ${dz.contact}`);
      lines.push('');
    }
  }

  // ── Legacy health ─────────────────────────────────────────────────────────
  if (legacyReport) {
    appendLegacySection(lines, legacyReport);
  }

  const content = lines.join('\n');
  const outPath = path.join(codebaseDir, 'MASTER.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, content);
  return outPath;
}

function formatNodeSection(node, summary, nodes) {
  const lines = [];
  lines.push(`### ${node.file}`);
  lines.push('');
  lines.push(summary || '*No summary*');
  lines.push('');

  const staticImports = node.imports.filter(i => nodes[i]);
  const agentImports = node.imports.filter(i => !nodes[i] && i.startsWith('.'));

  if (staticImports.length > 0) {
    lines.push(`**Imports (static):** ${staticImports.slice(0, 8).join(', ')}`);
  }
  if (agentImports.length > 0) {
    lines.push(`**Imports (unresolved):** ${agentImports.slice(0, 5).join(', ')}`);
  }
  if (node.importedBy.length > 0) {
    lines.push(`**Imported by:** ${node.importedBy.slice(0, 8).join(', ')}`);
  }
  lines.push(`**Risk score:** ${node.riskScore} | **Exports:** ${node.exports.length}`);

  if (node.meta?.gitHistory) {
    const g = node.meta.gitHistory;
    lines.push(`**Age:** ${g.firstCommit ? `Created ${g.firstCommit} (${Math.round(g.ageInDays / 365 * 10) / 10}yr)` : 'unknown'}`);
    if (g.bugFixCommits > 0) lines.push(`**Bug history:** ${g.bugFixCommits} bug fix commits`);
    if (g.hackCommits > 0) lines.push(`**Known workarounds:** ${g.hackCommits} commits mention HACK/workaround`);
    if (g.authors?.length > 0) lines.push(`**Who knows this:** ${g.authors[0].email} (${g.authors[0].commits} commits)`);
  }

  lines.push('');
  return lines.join('\n');
}

function appendLegacySection(lines, report) {
  if (report.godFiles?.length > 0) {
    lines.push('## Legacy health report');
    lines.push('');
    lines.push('### God files (doing too many things)');
    lines.push('| File | Exports | Lines | Concerns |');
    lines.push('|------|---------|-------|----------|');
    for (const gf of report.godFiles) {
      lines.push(`| ${gf.file} | ${gf.exports} | ${gf.lines} | ${gf.concerns} |`);
    }
    lines.push('');
  }

  if (report.circularDeps?.length > 0) {
    lines.push('### Circular dependencies');
    lines.push('| Cycle | Risk |');
    lines.push('|-------|------|');
    for (const c of report.circularDeps) {
      lines.push(`| ${c.files.join(' → ')} | ${c.risk} |`);
    }
    lines.push('');
  }

  if (report.unannotatedDynamic?.length > 0) {
    lines.push('### Unannotated dynamic patterns');
    lines.push('| File | Line | Pattern | Action |');
    lines.push('|------|------|---------|--------|');
    for (const p of report.unannotatedDynamic.slice(0, 20)) {
      lines.push(`| ${p.file} | ${p.line} | ${p.pattern} | ${p.action} |`);
    }
    lines.push('');
  }

  if (report.techDebt?.length > 0) {
    lines.push('### Tech debt map');
    lines.push('| File | Bug fixes | Age | Coverage | Priority |');
    lines.push('|------|-----------|-----|----------|----------|');
    for (const td of report.techDebt.slice(0, 20)) {
      lines.push(`| ${td.file} | ${td.bugFixes} | ${td.age} | ${td.coverage} | ${td.priority} |`);
    }
    lines.push('');
  }
}

function generateStructuralArchOverview(stats, highValue) {
  const langs = Object.entries(stats.byLang || {})
    .sort((a, b) => b[1] - a[1])
    .map(([l, c]) => `${l} (${c})`)
    .join(', ');

  return `${stats.totalFiles} files across ${langs}. ${stats.totalEdges} dependency edges. ${highValue.length} high-value modules (entry points or widely imported). ${stats.highRiskFiles} high-risk files.`;
}

async function callHaikuArchitecture(highValue, stats, apiKey) {
  const topFiles = highValue.slice(0, 8).map(n =>
    `${n.file}: ${n.exports.slice(0, 3).join(',')} — imported by ${n.importedBy.length}`
  ).join('\n');

  const prompt = `Codebase stats: ${stats.totalFiles} files, ${stats.totalEdges} edges, langs: ${JSON.stringify(stats.byLang)}
Top modules:
${topFiles}
Write 3 sentences describing the architecture. Be specific about patterns used.`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
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
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = { generateMasterMd, isHighValue };
