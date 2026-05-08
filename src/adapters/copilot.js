'use strict';

/**
 * @wednesday-skills:purpose GitHub Copilot adapter — injects skill block into .github/copilot-instructions.md.
 * @wednesday-skills:risk low
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

  injectBlock(configFile, START, END, block, '# GitHub Copilot Instructions');
}

module.exports = { sync };
