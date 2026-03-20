/**
 * 2C-3 — Conflict explainer
 * Explains dependency conflicts with actionable resolution steps.
 * Uses conflict JSON only — not full graph. Cached by conflict signature.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

/**
 * Detect conflicts in package.json / go.mod
 */
function detectConflicts(rootDir) {
  const conflicts = [];

  // ── npm / package.json ────────────────────────────────────────────────────
  const pkgJson = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      const all = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check for known conflict patterns
      if (all.react && all.preact) {
        conflicts.push({ type: 'peer-conflict', pkg1: 'react', pkg2: 'preact', severity: 'high' });
      }

      // Duplicate major versions (simplified heuristic)
      const byName = {};
      for (const [name, ver] of Object.entries(all)) {
        const major = ver.replace(/[^0-9]/, '')[0];
        if (!byName[name]) byName[name] = [];
        byName[name].push({ ver, major });
      }

      // Check peerDependencies conflicts
      if (pkg.peerDependencies) {
        for (const [peer, required] of Object.entries(pkg.peerDependencies)) {
          if (all[peer]) {
            const installed = all[peer];
            // Simplified semver check: major version mismatch
            const reqMajor = parseInt(required.replace(/[^0-9]/, ''));
            const instMajor = parseInt(installed.replace(/[^0-9]/, ''));
            if (!isNaN(reqMajor) && !isNaN(instMajor) && reqMajor !== instMajor) {
              conflicts.push({
                type: 'version-mismatch',
                package: peer,
                required,
                installed,
                severity: 'medium',
              });
            }
          }
        }
      }
    } catch {}
  }

  return conflicts;
}

/**
 * Explain a conflict using Haiku
 */
async function explainConflict(conflict, apiKey) {
  const sig = crypto.createHash('sha1').update(JSON.stringify(conflict)).digest('hex');

  const prompt = `Dependency conflict:
${JSON.stringify(conflict, null, 2)}
Give 3 specific resolution steps. Be concise. Start with the quickest fix.`;

  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
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
          resolve({ conflict, explanation: json.choices?.[0]?.message?.content?.trim(), sig });
        } catch { resolve({ conflict, explanation: null, sig }); }
      });
    });
    req.on('error', () => resolve({ conflict, explanation: null, sig }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ conflict, explanation: null, sig }); });
    req.write(body);
    req.end();
  });
}

/**
 * Write conflicts.json to analysis dir
 */
async function analyzeAndWriteConflicts(rootDir, analysisDir, apiKey) {
  const conflicts = detectConflicts(rootDir);
  const results = [];

  for (const conflict of conflicts) {
    if (apiKey) {
      const explained = await explainConflict(conflict, apiKey);
      results.push(explained);
    } else {
      results.push({ conflict, explanation: null });
    }
  }

  fs.mkdirSync(analysisDir, { recursive: true });
  const outPath = path.join(analysisDir, 'conflicts.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  return results;
}

module.exports = { detectConflicts, explainConflict, analyzeAndWriteConflicts };
