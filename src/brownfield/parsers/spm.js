/**
 * 2A-3 — Swift Package Manager parser
 * Reads Package.swift to extract SPM dependencies
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parse(rootDir) {
  const result = { packages: [] };

  const pkgSwift = path.join(rootDir, 'Package.swift');
  if (!fs.existsSync(pkgSwift)) return result;

  try {
    const src = fs.readFileSync(pkgSwift, 'utf8');

    // .package(url: "...", ...)  or  .package(name: "...", url: "...", ...)
    const urlRe = /\.package\s*\([^)]*url\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = urlRe.exec(src)) !== null) {
      // Extract package name from URL (last path component without .git)
      const name = m[1].split('/').pop().replace(/\.git$/, '');
      result.packages.push({ name, url: m[1] });
    }
  } catch {}

  return result;
}

module.exports = { parse };
