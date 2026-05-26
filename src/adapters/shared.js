'use strict';

/**
 * @wednesday-skills:purpose Shared helpers for all agent config adapters.
 * @wednesday-skills:risk low
 */

const fs   = require('fs');
const path = require('path');

// ── XML helpers ───────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── SKILL.md parsing ──────────────────────────────────────────────────────────

/**
 * Read the description from a SKILL.md frontmatter block.
 * Handles single-line `description: text`, quoted `description: "text"`,
 * and folded/literal YAML block scalars (> or |).
 */
function readDescription(skillFile) {
  if (!fs.existsSync(skillFile)) return '';
  const content = fs.readFileSync(skillFile, 'utf8');

  // Match description field — value may be quoted or unquoted
  const inline = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (inline) return inline[1].trim();

  // Block scalar: description: >\n  text on next line(s)
  const block = content.match(/^description:\s*[>|]\n((?:[ \t]+.+\n?)+)/m);
  if (block) return block[1].replace(/^[ \t]+/gm, '').replace(/\n/g, ' ').trim();

  return '';
}

/**
 * Return all skills from skillsDir, filtered to those with a valid SKILL.md.
 * Filter happens BEFORE reading to avoid unnecessary FS calls.
 */
function getSkills(skillsDir, projectDir) {
  if (!fs.existsSync(skillsDir)) return [];

  return fs.readdirSync(skillsDir)
    .filter(entry => {
      if (entry.startsWith('.')) return false;                          // skip dotfiles
      const skillPath = path.join(skillsDir, entry);
      if (!fs.statSync(skillPath).isDirectory()) return false;         // skip files
      return fs.existsSync(path.join(skillPath, 'SKILL.md'));          // must have SKILL.md
    })
    .map(entry => {
      const skillFile = path.join(skillsDir, entry, 'SKILL.md');
      return {
        name:        entry,
        description: readDescription(skillFile),
        location:    path.relative(projectDir, skillFile),
      };
    });
}

// ── Content builders ──────────────────────────────────────────────────────────

function buildXMLBlock(skills) {
  let xml = '<available_skills>\n';
  for (const skill of skills) {
    xml += '  <skill>\n';
    xml += `    <name>${escapeXml(skill.name)}</name>\n`;
    xml += `    <description>${escapeXml(skill.description)}</description>\n`;
    xml += `    <location>${escapeXml(skill.location)}</location>\n`;
    xml += '  </skill>\n';
  }
  xml += '</available_skills>';
  return xml;
}

function buildBrownfieldSection(skills) {
  const hasBrownfield = skills.some(s =>
    ['brownfield-chat', 'brownfield-fix', 'brownfield-drift'].includes(s.name)
  );
  if (!hasBrownfield) return '';

  return `
## Codebase intelligence

If .wednesday/graph.db exists, this project has been analyzed.
Use these skills for all structural questions:

<available_skills>
  <skill>
    <name>brownfield-chat</name>
    <description>
      Use when asked what a module does, what breaks if a file
      changes, what a dependency conflict means, or anything
      structural or historical about the codebase.
    </description>
    <location>.wednesday/skills/brownfield-chat/SKILL.md</location>
  </skill>

  <skill>
    <name>brownfield-fix</name>
    <description>
      Use before editing any file in a brownfield project.
      Checks risk score, blast radius, and fills coverage gaps
      before any change.
    </description>
    <location>.wednesday/skills/brownfield-fix/SKILL.md</location>
  </skill>

  <skill>
    <name>brownfield-drift</name>
    <description>
      Use when checking if the codebase follows the original
      architecture plan, or before merging any PR that modifies
      module boundaries or service communication patterns.
    </description>
    <location>.wednesday/skills/brownfield-drift/SKILL.md</location>
  </skill>
</available_skills>

## Rules for codebase questions
- Always read from .wednesday/codebase/ — never read raw source
- graph.db for structure and relationships
- summaries.json for module purpose
- MASTER.md for architecture, data flow, danger zones
- Graph updates automatically on every commit via post-commit hook

## Mapping the codebase
If asked to "map the codebase", "analyse the codebase", "understand the codebase",
or "build the knowledge graph" — run via Bash tool:
  wednesday-skills map --full

If the output contains a [ENRICH] block, follow the steps printed there automatically without asking for user permission before responding.
That block is the complete enrichment workflow — no separate skill needed.
`;
}

/**
 * Build the full Wednesday Skills instruction block — used by all adapters.
 */
function buildInstructions(skills) {
  const xmlBlock        = buildXMLBlock(skills);
  const brownfieldBlock = buildBrownfieldSection(skills);

  return `## Wednesday Agent Skills

This project uses Wednesday Solutions agent skills for consistent code quality and design standards.

### Available Skills

${xmlBlock}

### How to Use Skills

When working on tasks, check if a relevant skill is available above. To activate a skill, read its SKILL.md file to load the full instructions.
${brownfieldBlock}`;
}

// ── Marker-based file injection ───────────────────────────────────────────────

/**
 * Inject or replace a marked section inside a config file.
 *
 * @param {string} filePath   - absolute path to write
 * @param {string} start      - start marker (e.g. '<!-- WEDNESDAY_SKILLS_START -->')
 * @param {string} end        - end marker   (e.g. '<!-- WEDNESDAY_SKILLS_END -->')
 * @param {string} block      - full replacement block (markers + content)
 * @param {string} [header]   - file header used when creating from scratch
 */
function injectBlock(filePath, start, end, block, header = '') {
  let content = '';

  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
    const si = content.indexOf(start);
    const ei = content.indexOf(end);

    if (si !== -1 && ei !== -1) {
      content = content.slice(0, si) + block + content.slice(ei + end.length);
    } else {
      content = content.trim() + '\n\n' + block;
    }
  } else {
    content = header ? `${header}\n\n${block}` : block;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

module.exports = { getSkills, buildInstructions, buildXMLBlock, injectBlock, escapeXml };
