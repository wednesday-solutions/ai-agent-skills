#!/usr/bin/env node
'use strict';

/**
 * Generate registry/index.json from all skills in the skills/ directory.
 * Run automatically by GitHub Action on every push to main that touches skills/.
 */

const fs   = require('fs');
const path = require('path');

const SKILLS_DIR   = path.join(__dirname, '..', 'skills');
const REGISTRY_OUT = path.join(__dirname, '..', 'registry', 'index.json');
const EXISTING     = fs.existsSync(REGISTRY_OUT)
  ? JSON.parse(fs.readFileSync(REGISTRY_OUT, 'utf8'))
  : { skills: [] };

// Build a download count map from existing registry to preserve counts
const downloadMap = {};
for (const s of (EXISTING.skills || [])) {
  downloadMap[s.name] = s.downloads || 0;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  let currentKey = null;
  let inList = false;

  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      inList = false;
      const val = kv[2].trim();
      if (val === '' || val === null) {
        fm[currentKey] = [];
        inList = true;
      } else if (val.startsWith('[')) {
        fm[currentKey] = val.replace(/[\[\]]/g, '').split(',').map(s => s.trim().replace(/['"]/g, ''));
      } else {
        fm[currentKey] = val.replace(/^["']|["']$/g, '');
      }
      continue;
    }
    const listItem = line.match(/^\s{2}-\s*(.*)/);
    if (listItem && inList && currentKey) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(listItem[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return fm;
}

function collectSkills(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name);
    const skillFile = path.join(skillPath, 'SKILL.md');

    // Recurse into agents/
    if (entry.name === 'agents') {
      results.push(...collectSkills(skillPath, 'agents/'));
      continue;
    }

    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(content);
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const skillName = fm.name || entry.name;

    results.push({
      name:        skillName,
      version:     fm.version  || '1.0.0',
      description: fm.description || '',
      tags:        Array.isArray(fm.tags)      ? fm.tags      : [],
      requires:    Array.isArray(fm.requires)  ? fm.requires  : [],
      conflicts:   Array.isArray(fm.conflicts) ? fm.conflicts : [],
      author:      fm.metadata?.author || (fm['metadata'] ? undefined : undefined) || 'wednesday-solutions',
      license:     fm.license || 'MIT',
      wordCount,
      downloads:   downloadMap[skillName] || 0,
      path:        `skills/${prefix}${entry.name}`,
    });
  }
  return results;
}

const skills = collectSkills(SKILLS_DIR);
skills.sort((a, b) => a.name.localeCompare(b.name));

const registry = {
  version:   '1.0',
  updatedAt: new Date().toISOString(),
  count:     skills.length,
  skills,
};

fs.mkdirSync(path.dirname(REGISTRY_OUT), { recursive: true });
fs.writeFileSync(REGISTRY_OUT, JSON.stringify(registry, null, 2));

console.log(`Registry updated: ${skills.length} skills → registry/index.json`);
skills.forEach(s => console.log(`  ${s.name.padEnd(30)} v${s.version}  (${s.wordCount} words)`));
