/**
 * 2A-3 — CocoaPods parser
 * Reads Podfile and Podfile.lock to extract iOS native dependencies
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parse(rootDir) {
  const result = { pods: [], lockPods: [] };

  // ── Podfile ───────────────────────────────────────────────────────────────
  const podfile = path.join(rootDir, 'Podfile');
  if (fs.existsSync(podfile)) {
    try {
      const src = fs.readFileSync(podfile, 'utf8');
      const podRe = /pod\s+['"]([^'"]+)['"]/g;
      let m;
      while ((m = podRe.exec(src)) !== null) {
        result.pods.push(m[1]);
      }
    } catch {}
  }

  // ── Podfile.lock ──────────────────────────────────────────────────────────
  const lockfile = path.join(rootDir, 'Podfile.lock');
  if (fs.existsSync(lockfile)) {
    try {
      const src = fs.readFileSync(lockfile, 'utf8');
      // PODS: section lists "  - PodName (version)"
      const podsSection = src.match(/^PODS:([\s\S]*?)(?=^\w)/m);
      if (podsSection) {
        const lockRe = /^\s+-\s+([\w-/]+)\s+\(/gm;
        let m;
        while ((m = lockRe.exec(podsSection[1])) !== null) {
          result.lockPods.push(m[1]);
        }
      }
    } catch {}
  }

  return result;
}

module.exports = { parse };
