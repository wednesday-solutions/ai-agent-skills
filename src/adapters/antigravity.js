'use strict';

/**
 * Antigravity adapter — copies skill files to Antigravity's skills directory.
 *
 * Antigravity reads skills from a directory on disk, not from a config file.
 * Default path: ~/.gemini/antigravity/skills/
 *
 * The path is taken from tools.json `config` field. Default is set in index.js
 * using os.homedir() so it works on both macOS and Linux.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Resolve ~ in paths */
function resolvePath(p) {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function sync(projectDir, skillsDir, toolConfig) {
  const destBase = resolvePath(toolConfig.config);

  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found: ${skillsDir}`);
  }

  // Create Antigravity skills directory if it doesn't exist
  fs.mkdirSync(destBase, { recursive: true });

  const skillFolders = fs.readdirSync(skillsDir);
  let copied = 0;

  for (const skillName of skillFolders) {
    const src = path.join(skillsDir, skillName);
    if (!fs.statSync(src).isDirectory()) continue;

    const dest = path.join(destBase, skillName);
    copyRecursive(src, dest);
    copied++;
  }

  console.log(`    Copied ${copied} skill(s) to ${destBase}`);
}

module.exports = { sync };
