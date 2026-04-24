const { lineAt } = require('../core/parser');
const path = require('path');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip string literals from source.
 */
function stripStrings(src) {
  return src
    .replace(/`(?:[^`\\]|\\.)*`/g,   m => '`' + ' '.repeat(Math.max(0, m.length - 2)) + '`')
    .replace(/"(?:[^"\\]|\\.)*"/g,   m => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
    .replace(/'(?:[^'\\]|\\.)*'/g,   m => "'" + ' '.repeat(Math.max(0, m.length - 2)) + "'");
}

function getSourceSymbol(line, fileSymbols) {
  if (!fileSymbols || fileSymbols.length === 0) return null;
  const sorted = [...fileSymbols].sort((a, b) => b.lineStart - a.lineStart);
  for (const sym of sorted) {
    if (line >= sym.lineStart) return sym;
  }
  return null;
}

/**
 * Extracts call sites for symbols.
 */
function extractCallEdges(file, src, node, symbolIndex) {
  const fileCalls = new Set();
  const symbolCalls = [];
  const clean = stripStrings(src);
  const byName = symbolIndex.byName;

  if (!byName) return [];

  // 1. Map local names to target qualified names
  const localToTarget = new Map();
  if (node.meta && node.meta.aliases) {
    for (const [local, target] of Object.entries(node.meta.aliases)) {
      localToTarget.set(local, target);
    }
  }

  // 2. Go package visibility
  const isGo = node.lang === 'go';
  const samePackageFiles = new Set();
  if (isGo) {
    const dir = path.dirname(file);
    for (const [qName] of symbolIndex) {
      const f = qName.split('::')[0];
      if (path.dirname(f) === dir) samePackageFiles.add(f);
    }
  }

  function addCall(index, targetFile, targetName) {
    const line = lineAt(src, index);
    const sourceSym = getSourceSymbol(line, node.symbols);
    const sourceName = sourceSym ? sourceSym.name : '(top-level)';
    const currentSymbol = sourceSym?.name || '(module)';

    // Ignore self-match on declaration line
    if (sourceSym && sourceSym.name === targetName && file === targetFile && line === sourceSym.lineStart) {
      return;
    }

    fileCalls.add(`${targetFile}::${targetName}`);
    symbolCalls.push({
      sourceSymbol: currentSymbol,
      targetFile,
      targetSymbol: targetName,
      kind: 'call'
    });
  }

  // 3. Scan
  
  // a) Aliased / Namespace
  for (const [local, target] of localToTarget) {
    if (target.name === '*') {
      for (const [qName, entry] of symbolIndex) {
        if (entry.file !== target.file) continue;
        const nsRe = new RegExp(`\\b${escapeRegex(local)}\\.${escapeRegex(entry.name)}\\b`, 'g');
        let m;
        while ((m = nsRe.exec(clean)) !== null) addCall(m.index, entry.file, entry.name);
      }
    } else {
      const callRe = new RegExp(`\\b${escapeRegex(local)}\\b`, 'g');
      let m;
      while ((m = callRe.exec(clean)) !== null) {
        const charAfter = clean[m.index + local.length];
        if (charAfter === '(' || charAfter === '.') {
          addCall(m.index, target.file, target.name);
        }
      }
    }
  }

  // b & c) Direct / Internal
  for (const [name, entries] of byName) {
    if (localToTarget.has(name)) continue;

    const callRe = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
    let m;
    while ((m = callRe.exec(clean)) !== null) {
      const charAfter = clean[m.index + name.length];
      if (charAfter !== '(' && charAfter !== '.') continue;

      const candidates = entries.filter(e => {
        const samePkg = isGo && samePackageFiles.has(e.file);
        const isImported = node.imports && node.imports.includes(e.file);
        if (e.file === file || samePkg || isImported) return true;
        return false;
      });

      for (const entry of candidates) {
        addCall(m.index, entry.file, entry.name);
      }
    }
  }

  // Deduplicate
  const uniqueSymbolCalls = [];
  const seen = new Set();
  for (const c of symbolCalls) {
    const key = `${c.sourceSymbol}|${c.targetFile}|${c.targetSymbol}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSymbolCalls.push(c);
    }
  }

  node.symbolCalls = uniqueSymbolCalls;
  return Array.from(fileCalls);
}

module.exports = { extractCallEdges };
