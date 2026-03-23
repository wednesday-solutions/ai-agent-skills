/**
 * 3B2 — Architecture drift detector
 * Compares machine-readable constraints from PLAN.md against dep-graph.json.
 * Flags boundary violations with the commit that introduced each one.
 * Zero LLM — pure graph traversal.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { findCircularDeps } = require('./dead-code');

// ── Glob matcher (no external dependency) ────────────────────────────────────

/**
 * Match a file path against a glob pattern.
 * Supports **, *, ? — no brace expansion needed.
 * Single-pass tokeniser to avoid replacement interference.
 */
function matchGlob(pattern, str) {
  // Normalise separators
  const p = pattern.replace(/\\/g, '/');
  const s = str.replace(/\\/g, '/');

  // Tokenise the pattern into literal chars and glob wildcards
  let regexStr = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*' && p[i + 1] === '*') {
      // ** — match anything including slashes
      if (p[i + 2] === '/') {
        regexStr += '(?:.+/)?';   // **/ → optional path prefix
        i += 3;
      } else {
        regexStr += '.*';          // ** at end or before non-slash
        i += 2;
      }
    } else if (ch === '*') {
      regexStr += '[^/]*';         // * — match non-slash chars
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';          // ? — match single non-slash char
      i++;
    } else {
      // Escape regex special chars
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`).test(s);
}

function matchesAnyGlob(globs, file) {
  const patterns = Array.isArray(globs) ? globs : [globs];
  return patterns.some(p => matchGlob(p, file));
}

// ── Load constraints from PLAN.md ────────────────────────────────────────────

/**
 * Load machine-readable constraints block from PLAN.md.
 * Looks for a JSON block with "boundaries" key, embedded in any code fence.
 */
function loadConstraints(rootDir) {
  const planPath = path.join(rootDir, 'PLAN.md');
  if (!fs.existsSync(planPath)) return null;

  const content = fs.readFileSync(planPath, 'utf8');

  // Find JSON blocks in code fences
  const jsonBlocks = [...content.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)]
    .map(m => m[1].trim());

  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed.boundaries && Array.isArray(parsed.boundaries)) {
        return parsed;
      }
    } catch {
      // not valid JSON, skip
    }
  }

  return null;
}

// ── Git blame — find commit that introduced an edge ───────────────────────────

/**
 * Find the commit hash, date, and author that first added an import line.
 */
function findIntroducingCommit(fromFile, toFile, rootDir) {
  try {
    // Search for the import/require line in the file's git log
    const basename = path.basename(toFile, path.extname(toFile));
    const log = execSync(
      `git log --follow --diff-filter=A --format="%H|%ae|%ad|%s" --date=short -S "${basename}" -- "${fromFile}"`,
      { cwd: rootDir, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!log) return null;

    const [hash, author, date, subject] = log.split('\n')[0].split('|');
    return { hash: hash?.slice(0, 8), author, date, subject };
  } catch {
    return null;
  }
}

// ── Rule checkers ────────────────────────────────────────────────────────────

/**
 * Check forbidden edges: from glob → to glob must never exist.
 */
function checkForbidden(rule, nodes, rootDir) {
  const violations = [];

  for (const [file, node] of Object.entries(nodes)) {
    if (!matchesAnyGlob(rule.from, file)) continue;

    for (const imp of node.imports) {
      if (matchesAnyGlob(rule.to, imp)) {
        const introducedBy = findIntroducingCommit(file, imp, rootDir);
        violations.push({
          rule: rule.rule,
          description: rule.description,
          type: 'forbidden',
          severity: 'high',
          from: file,
          to: imp,
          edge: `${file} → ${imp}`,
          introducedBy,
          fix: `Move the logic from \`${imp}\` behind an API boundary, or import through an intermediary service.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Check ownership: logic matching a pattern must only appear in the owner glob.
 * Checks: file path contains the pattern AND file is outside owner glob.
 */
function checkOwnership(rule, nodes) {
  const violations = [];
  const patternRe = new RegExp(rule.pattern, 'i');

  for (const [file, node] of Object.entries(nodes)) {
    // Skip files that are inside the owner
    if (matchesAnyGlob(rule.owner, file)) continue;

    // Check if the file exports something matching the pattern
    const matchingExport = node.exports.find(e => patternRe.test(e));
    if (matchingExport) {
      violations.push({
        rule: rule.rule,
        description: rule.description,
        type: 'ownership',
        severity: 'high',
        file,
        matchingExport,
        edge: `${file} exports ${matchingExport}`,
        introducedBy: null,
        fix: `Move \`${matchingExport}\` from \`${file}\` into the owner module: ${rule.owner}`,
      });
    }
  }

  return violations;
}

/**
 * Check no-direct-import: services listed in "between" must not import each other directly.
 */
function checkNoDirectImport(rule, nodes) {
  const violations = [];
  const [groupA, groupB] = rule.between || [];
  if (!groupA || !groupB) return violations;

  for (const [file, node] of Object.entries(nodes)) {
    const inA = matchesAnyGlob(groupA, file);
    const inB = matchesAnyGlob(groupB, file);
    if (!inA && !inB) continue;

    for (const imp of node.imports) {
      const impInA = matchesAnyGlob(groupA, imp);
      const impInB = matchesAnyGlob(groupB, imp);

      if ((inA && impInB) || (inB && impInA)) {
        violations.push({
          rule: rule.rule,
          description: rule.description,
          type: 'no-direct-import',
          severity: 'high',
          from: file,
          to: imp,
          edge: `${file} → ${imp}`,
          introducedBy: null,
          fix: `Replace the direct import with an HTTP/RPC call between \`${groupA}\` and \`${groupB}\`.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Check no-cycle: find circular dependencies in scope.
 */
function checkNoCycle(rule, nodes) {
  const cycles = findCircularDeps(nodes);
  const scope = rule.scope || '**';

  return cycles
    .filter(cycle => cycle.files.some(f => matchGlob(scope, f)))
    .map(cycle => ({
      rule: rule.rule,
      description: rule.description,
      type: 'no-cycle',
      severity: 'medium',
      cycle: cycle.files,
      edge: cycle.files.join(' ↔ '),
      introducedBy: null,
      fix: `Extract shared types or utilities to break the cycle: ${cycle.files.slice(0, 2).join(' ↔ ')}`,
    }));
}

// ── Main detector ─────────────────────────────────────────────────────────────

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Detect architecture drift.
 * @param {Object} constraints - parsed from PLAN.md
 * @param {Object} graph - dep-graph.json
 * @param {string} rootDir
 * @param {Object} opts - { since?: string } git commit ref to limit scope
 * @returns {Array} violations sorted by severity
 */
function detectDrift(constraints, graph, rootDir, opts = {}) {
  const violations = [];
  const nodes = graph.nodes;

  // If --since, build a set of files changed since that ref
  let changedFiles = null;
  if (opts.since) {
    try {
      const raw = execSync(
        `git diff --name-only ${opts.since}..HEAD`,
        { cwd: rootDir, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      changedFiles = new Set(raw.split('\n').filter(Boolean));
    } catch {
      // ignore — proceed without scoping
    }
  }

  for (const rule of (constraints.boundaries || [])) {
    let ruleViolations = [];

    switch (rule.type) {
      case 'forbidden':
        ruleViolations = checkForbidden(rule, nodes, rootDir);
        break;
      case 'ownership':
        ruleViolations = checkOwnership(rule, nodes);
        break;
      case 'no-direct-import':
        ruleViolations = checkNoDirectImport(rule, nodes);
        break;
      case 'no-cycle':
        ruleViolations = checkNoCycle(rule, nodes);
        break;
      default:
        continue;
    }

    // If --since, only include violations where at least one file was recently changed
    if (changedFiles) {
      ruleViolations = ruleViolations.filter(v => {
        if (v.from && changedFiles.has(v.from)) return true;
        if (v.to && changedFiles.has(v.to)) return true;
        if (v.file && changedFiles.has(v.file)) return true;
        if (v.cycle && v.cycle.some(f => changedFiles.has(f))) return true;
        return false;
      });
    }

    violations.push(...ruleViolations);
  }

  return violations.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );
}

// ── Report formatter ──────────────────────────────────────────────────────────

/**
 * Format violations as a human-readable report string.
 */
function formatDriftReport(violations, opts = {}) {
  if (violations.length === 0) {
    return opts.since
      ? `No new architecture drift introduced since ${opts.since}.`
      : 'No architecture drift detected. Codebase matches PLAN.md constraints.';
  }

  const lines = [
    `Architecture drift report — ${new Date().toISOString().slice(0, 10)}`,
    opts.since ? `Scope: changes since ${opts.since}` : '',
    '',
    `VIOLATIONS (${violations.length}):`,
    '',
  ].filter(l => l !== undefined);

  for (const v of violations) {
    lines.push(`${v.severity.toUpperCase()} — ${v.rule}`);
    lines.push(`  ${v.description}`);
    lines.push(`  Edge: ${v.edge}`);
    if (v.introducedBy) {
      lines.push(`  Introduced: commit ${v.introducedBy.hash} on ${v.introducedBy.date} by ${v.introducedBy.author}`);
    }
    lines.push(`  Fix: ${v.fix}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { detectDrift, loadConstraints, formatDriftReport, matchGlob };
