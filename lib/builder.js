'use strict';

/**
 * AI Skill Builder
 *
 * Interactive terminal tool that generates a valid SKILL.md from a plain-English description.
 * Uses Haiku via the router for generation. Validates before saving.
 * submit() opens a GitHub PR against the public registry.
 */

const fs      = require('fs');
const path    = require('path');
const readline = require('readline');
const { callWithEscalation } = require('./router');

const REQUIRED_SECTIONS = ['name:', 'description:', '## When to use', '## What to do', '## Never'];
const MAX_WORDS = 500;

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(content) {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const missingSections = REQUIRED_SECTIONS.filter(s => !content.includes(s));
  return {
    valid: wordCount < MAX_WORDS && missingSections.length === 0,
    wordCount,
    missingSections,
  };
}

// ─── Generation ───────────────────────────────────────────────────────────────

async function generate(description) {
  const prompt = `You are an expert at writing Claude Code skill files.

Generate a SKILL.md for the following skill description:
"${description}"

The output must be a complete SKILL.md following this exact format:
---
name: <kebab-case-name>
description: <one sentence, under 120 chars>
license: MIT
metadata:
  author: <leave blank>
  version: "1.0"
tags:
  - <tag1>
  - <tag2>
---

# <Title>

## When to use
<3-5 bullet points of exact trigger phrases or situations>

## What to do
<numbered steps — specific, actionable, with any bash commands in code blocks>

## Never
<3-6 bullet points of hard rules>

Rules:
- Under 500 words total
- No org-specific references (no "Wednesday", no internal URLs)
- No hardcoded model names
- Bash commands must be specific, not generic placeholders
- The "When to use" section must include exact phrases someone would say

Output ONLY the SKILL.md content. No explanation, no preamble.`;

  const result = await callWithEscalation(prompt, 'generate-skill', { maxTokens: 1500 });
  return result.text.trim();
}

// ─── Interactive builder ──────────────────────────────────────────────────────

async function interactive(targetDir) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(q, resolve));

  console.log('');
  console.log('\x1b[36mAI Skill Builder\x1b[0m');
  console.log('Describe what this skill should do:');
  console.log('');

  const description = await ask('> ');
  if (!description.trim()) { console.log('Cancelled.'); rl.close(); return; }

  console.log('\nGenerating...\n');

  let content;
  try {
    content = await generate(description.trim());
  } catch (e) {
    console.error(`\x1b[31mGeneration failed: ${e.message}\x1b[0m`);
    rl.close();
    process.exit(1);
  }

  const check = validate(content);
  if (!check.valid) {
    console.log('\x1b[33mGenerated skill failed validation:\x1b[0m');
    if (check.wordCount >= MAX_WORDS) console.log(`  Word count: ${check.wordCount} (max ${MAX_WORDS})`);
    if (check.missingSections.length) console.log(`  Missing sections: ${check.missingSections.join(', ')}`);
    console.log('\nRegenerating with stricter prompt...\n');
    try {
      content = await generate(description.trim() + ' Keep it concise — under 400 words.');
    } catch (e) {
      console.error(`\x1b[31mRegeneration failed: ${e.message}\x1b[0m`);
      rl.close();
      process.exit(1);
    }
    const recheck = validate(content);
    if (!recheck.valid) {
      console.log('\x1b[31mValidation failed after retry. Showing raw output:\x1b[0m\n');
      console.log(content);
      rl.close();
      return;
    }
  }

  console.log('─'.repeat(60));
  console.log(content);
  console.log('─'.repeat(60));
  console.log(`\nWord count: ${validate(content).wordCount} ✓\n`);

  const action = await ask('Save? (y/n/edit): ');

  if (action.toLowerCase() === 'n') {
    console.log('Discarded.');
    rl.close();
    return;
  }

  if (action.toLowerCase() === 'edit') {
    const nameMatch = content.match(/^name:\s*(.+)/m);
    const skillName = nameMatch ? nameMatch[1].trim() : 'custom-skill';
    const tmpFile = path.join(require('os').tmpdir(), `${skillName}.md`);
    fs.writeFileSync(tmpFile, content);
    console.log(`\nOpened in $EDITOR. Save and close to continue.`);
    const editor = process.env.EDITOR || 'nano';
    require('child_process').spawnSync(editor, [tmpFile], { stdio: 'inherit' });
    content = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
  }

  // Extract name from frontmatter
  const nameMatch = content.match(/^name:\s*(.+)/m);
  const skillName = nameMatch ? nameMatch[1].trim() : 'custom-skill';
  const skillDir = path.join(targetDir, '.wednesday', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);

  console.log(`\n\x1b[32m✓ Saved to .wednesday/skills/${skillName}/SKILL.md\x1b[0m`);
  console.log(`Run \x1b[36mwednesday-skills sync\x1b[0m to activate in Claude Code.\n`);

  rl.close();
}

// ─── Submit to registry ───────────────────────────────────────────────────────

async function submit(skillName, targetDir) {
  const skillDir = path.join(targetDir, '.wednesday', 'skills', skillName);
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    console.error(`\x1b[31mSkill "${skillName}" not found at ${skillFile}\x1b[0m`);
    process.exit(1);
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  const check = validate(content);

  if (!check.valid) {
    console.error('\x1b[31mSkill fails validation — fix before submitting:\x1b[0m');
    if (check.wordCount >= MAX_WORDS) console.error(`  Word count: ${check.wordCount} (max ${MAX_WORDS})`);
    check.missingSections.forEach(s => console.error(`  Missing section: ${s}`));
    process.exit(1);
  }

  // Copy skill to a temp branch in the local repo for PR submission
  const pkgRoot = path.join(__dirname, '..');
  const destDir = path.join(pkgRoot, 'skills', skillName);

  if (fs.existsSync(destDir)) {
    console.error(`\x1b[33mSkill "${skillName}" already exists in the registry.\x1b[0m`);
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(skillFile, path.join(destDir, 'SKILL.md'));

  const { execSync } = require('child_process');
  const branch = `feat/skill-${skillName}`;

  try {
    execSync(`git -C "${pkgRoot}" checkout -b ${branch}`, { stdio: 'pipe' });
    execSync(`git -C "${pkgRoot}" add skills/${skillName}/`, { stdio: 'pipe' });
    execSync(`git -C "${pkgRoot}" commit -m "feat(skills): add community skill ${skillName}"`, { stdio: 'pipe' });
    execSync(`git -C "${pkgRoot}" push origin ${branch}`, { stdio: 'pipe' });

    const prBody = `## Skill submission: ${skillName}\n\n- [ ] Under 500 words\n- [ ] Has all required sections\n- [ ] No internal references\n- [ ] Tested locally — triggers correctly\n- [ ] No hardcoded model names`;
    execSync(`gh pr create --title "feat(skills): add community skill ${skillName}" --body "${prBody.replace(/"/g, '\\"')}" --base main`, { stdio: 'inherit', cwd: pkgRoot });

    console.log(`\n\x1b[32m✓ PR opened for "${skillName}"\x1b[0m`);
    console.log('Wednesday will review and merge. The registry auto-updates on merge.\n');
  } catch (e) {
    console.error(`\x1b[31mSubmission failed: ${e.message}\x1b[0m`);
    // Clean up
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(1);
  }
}

module.exports = { generate, validate, interactive, submit };
