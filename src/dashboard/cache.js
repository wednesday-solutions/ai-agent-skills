'use strict';

const fs = require('fs');
const path = require('path');

function loadTriageCache(projectDir) {
  const file = path.join(projectDir, '.wednesday', 'cache', 'triage.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function loadUsageData(projectDir) {
  const file = path.join(projectDir, '.wednesday', 'cache', 'usage.json');
  if (!fs.existsSync(file)) return { runs: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { runs: [] }; }
}

function loadInstalledSkills(projectDir) {
  const skillsDir = path.join(projectDir, '.wednesday', 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  return fs.readdirSync(skillsDir)
    .filter(entry => {
      const skillFile = path.join(skillsDir, entry, 'SKILL.md');
      return fs.existsSync(skillFile);
    })
    .map(entry => {
      const skillFile = path.join(skillsDir, entry, 'SKILL.md');
      const content = fs.readFileSync(skillFile, 'utf8');
      const versionMatch = content.match(/version:\s*["']?(\S+?)["']?$/m);
      return {
        name: entry,
        version: versionMatch ? `v${versionMatch[1]}` : 'v1.0',
      };
    });
}

module.exports = { loadTriageCache, loadUsageData, loadInstalledSkills };
