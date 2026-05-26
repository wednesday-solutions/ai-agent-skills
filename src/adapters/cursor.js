'use strict';

/**
 * @wednesday-skills:purpose Cursor adapter — injects skill block into .cursorrules.
 * @wednesday-skills:risk low
 *
 * Cursor uses a plain Markdown file (.cursorrules). Hash-comment markers are used
 * instead of HTML comments so the file stays valid for the Cursor rules parser.
 */

const path = require('path');
const { getSkills, buildInstructions, injectBlock } = require('./shared');

const START = '<!-- WEDNESDAY_SKILLS_START -->';
const END   = '<!-- WEDNESDAY_SKILLS_END -->';

function sync(projectDir, skillsDir, toolConfig) {
  const configFile   = path.join(projectDir, toolConfig.config);
  const skills       = getSkills(skillsDir, projectDir);
  const instructions = buildInstructions(skills);
  const block        = `${START}\n${instructions}\n${END}`;

  injectBlock(configFile, START, END, block);
}

module.exports = { sync };
