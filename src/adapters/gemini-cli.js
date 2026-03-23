'use strict';

/**
 * Gemini CLI adapter — injects <available_skills> XML block into GEMINI.md
 *
 * Same pattern as claude-code adapter but targets GEMINI.md.
 */

const fs = require('fs');
const path = require('path');

const START_MARKER = '<!-- WEDNESDAY_SKILLS_START -->';
const END_MARKER = '<!-- WEDNESDAY_SKILLS_END -->';

function buildXMLBlock(skillsDir, projectDir) {
  const skills = getSkills(skillsDir, projectDir);
  let xml = '<available_skills>\n';
  for (const skill of skills) {
    xml += '  <skill>\n';
    xml += `    <name>${skill.name}</name>\n`;
    xml += `    <description>${skill.description}</description>\n`;
    xml += `    <location>${skill.location}</location>\n`;
    xml += '  </skill>\n';
  }
  xml += '</available_skills>';
  return xml;
}

function getSkills(skillsDir, projectDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .filter(entry => fs.statSync(path.join(skillsDir, entry)).isDirectory())
    .map(entry => {
      const skillFile = path.join(skillsDir, entry, 'SKILL.md');
      const description = readDescription(skillFile);
      const location = path.relative(projectDir, skillFile);
      return { name: entry, description, location };
    })
    .filter(s => fs.existsSync(path.join(skillsDir, s.name, 'SKILL.md')));
}

function readDescription(skillFile) {
  if (!fs.existsSync(skillFile)) return '';
  const content = fs.readFileSync(skillFile, 'utf8');
  const match = content.match(/^description:\s*(.+)$/m);
  return match ? match[1].replace(/^["']|["']$/g, '') : '';
}

function sync(projectDir, skillsDir, toolConfig) {
  const configFile = path.join(projectDir, toolConfig.config);
  const xmlBlock = buildXMLBlock(skillsDir, projectDir);
  const block = `${START_MARKER}\n## Wednesday Agent Skills\n\n${xmlBlock}\n\n### How to use\nWhen a task involves a skill domain, read the SKILL.md at the location above to load the full instructions.\n${END_MARKER}`;

  let content = '';
  if (fs.existsSync(configFile)) {
    content = fs.readFileSync(configFile, 'utf8');
    const start = content.indexOf(START_MARKER);
    const end = content.indexOf(END_MARKER);
    if (start !== -1 && end !== -1) {
      content = content.slice(0, start) + block + content.slice(end + END_MARKER.length);
    } else {
      content = content.trim() + '\n\n' + block;
    }
  } else {
    content = `# Gemini Project Guidelines\n\n${block}`;
  }

  fs.writeFileSync(configFile, content);
}

module.exports = { sync };
