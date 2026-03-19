#!/usr/bin/env node

/**
 * Wednesday Agent Skills CLI
 * Installs agent skills and configures AI agents to discover them.
 *
 * Commands:
 *   install [dir]             Install skills and configure agents
 *   configure [dir] [agent]   Configure a specific agent
 *   sync [--tool <name>]      Re-run all adapters (or one) via tools.json
 *   dashboard [--pr <num>]    Launch Ink TUI dashboard
 *   plan [dir]                Run greenfield parallel persona planning
 *   list                      List available skills
 *   help                      Show help
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { syncAdapters, ensureToolsConfig } = require('../src/adapters/index.js');

// Colors for terminal output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      copyRecursive(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Parse YAML frontmatter from SKILL.md file
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

/**
 * Get skill metadata from installed skills
 */
function getInstalledSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];

  const skills = [];
  const entries = fs.readdirSync(skillsDir);

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry);
    const skillFile = path.join(skillPath, 'SKILL.md');

    if (fs.statSync(skillPath).isDirectory() && fs.existsSync(skillFile)) {
      const content = fs.readFileSync(skillFile, 'utf8');
      const frontmatter = parseFrontmatter(content);

      skills.push({
        name: frontmatter.name || entry,
        description: frontmatter.description || '',
        path: skillPath,
        skillFile: skillFile
      });
    }
  }

  return skills;
}

/**
 * Generate <available_skills> XML block for system prompts
 */
function generateSkillsXML(skills, baseDir) {
  let xml = '<available_skills>\n';

  for (const skill of skills) {
    const relativePath = path.relative(baseDir, skill.skillFile);
    xml += '  <skill>\n';
    xml += `    <name>${skill.name}</name>\n`;
    xml += `    <description>${skill.description}</description>\n`;
    xml += `    <location>${relativePath}</location>\n`;
    xml += '  </skill>\n';
  }

  xml += '</available_skills>';
  return xml;
}

/**
 * Generate instructions text for agent configuration
 */
function generateInstructions(skills, baseDir) {
  const skillsXML = generateSkillsXML(skills, baseDir);

  return `## Wednesday Agent Skills

This project uses Wednesday Solutions agent skills for consistent code quality and design standards.

### Available Skills

${skillsXML}

### How to Use Skills

When working on tasks, check if a relevant skill is available above. To activate a skill, read its SKILL.md file to load the full instructions.

For example:
- For code quality and development guidelines, read: .wednesday/skills/wednesday-dev/SKILL.md
- For design and UI component guidelines, read: .wednesday/skills/wednesday-design/SKILL.md

### Important

- The wednesday-design skill contains 492+ approved UI components. Always check the component library before creating custom components.
- The wednesday-dev skill enforces import ordering, complexity limits (max 8), and naming conventions.
`;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'install';

  console.log('');
  log('blue', '╔═══════════════════════════════════════════════════════════╗');
  log('blue', '║         Wednesday Agent Skills                            ║');
  log('blue', '╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  switch (command) {
    case 'install': {
      const installDir = (args[1] && !args[1].startsWith('--')) ? args[1] : process.cwd();
      install(installDir, args.includes('--skip-config'), args.includes('--all'));
      break;
    }
    case 'configure':
      configure(args[1] || process.cwd(), args[2]);
      break;
    case 'sync': {
      const toolIdx = args.indexOf('--tool');
      const tool = toolIdx !== -1 ? args[toolIdx + 1] : null;
      runSync(args[1] || process.cwd(), tool);
      break;
    }
    case 'dashboard': {
      const prIdx = args.indexOf('--pr');
      const prNum = prIdx !== -1 ? args[prIdx + 1] : null;
      launchDashboard(process.cwd(), prNum);
      break;
    }
    case 'plan':
      runPlan(args[1] || process.cwd(), args);
      break;
    case 'pr':
      runPR();
      break;
    case 'list':
      listSkills();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      log('red', `Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// ─── New Phase 1 commands ────────────────────────────────────────────────────

function runSync(targetDir, toolFilter) {
  targetDir = path.resolve(targetDir);
  log('blue', `Syncing skills to AI tools${toolFilter ? ` (${toolFilter})` : ''}...`);
  console.log('');
  syncAdapters(targetDir, toolFilter);
  console.log('');
  log('green', 'Sync complete.');
}

function launchDashboard(projectDir, prFilter) {
  projectDir = path.resolve(projectDir);
  const runner = path.join(__dirname, '..', 'src', 'dashboard', 'run.mjs');
  const args = [runner, projectDir];
  if (prFilter) args.push(String(prFilter));

  const proc = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });
  proc.on('exit', code => process.exit(code || 0));
}

function runPR() {
  const script = path.join(__dirname, '..', 'scripts', 'pr-create.js');
  const proc = spawn(process.execPath, [script], { stdio: 'inherit' });
  proc.on('exit', code => process.exit(code || 0));
}

function runPlan(targetDir, args) {
  targetDir = path.resolve(targetDir);
  const briefArg = args.indexOf('--brief');
  const scriptArgs = [path.join(__dirname, '..', 'scripts', 'plan.js'), targetDir];
  if (briefArg !== -1 && args[briefArg + 1]) {
    scriptArgs.push('--brief', args[briefArg + 1]);
  }

  log('blue', 'Starting greenfield planning...');
  console.log('');

  const proc = spawn(process.execPath, scriptArgs, { stdio: 'inherit' });
  proc.on('exit', code => process.exit(code || 0));
}

// ─────────────────────────────────────────────────────────────────────────────

// Skill metadata for checklist display
const SKILL_META = {
  'git-os':           { label: 'GIT-OS',           desc: 'Conventional commits, atomic changes, pre-push checklist', recommended: true },
  'pr-create':        { label: 'PR Create',         desc: 'Agent-driven PR creation with GIT-OS validation',          recommended: true },
  'triage-loop':      { label: 'Triage Loop',       desc: 'Unified PR review report (Gemini + coverage + Sonar)',     recommended: true },
  'greenfield':       { label: 'Greenfield Planner',desc: 'Multi-agent project planning → PLAN.md',                   recommended: false },
  'sprint':           { label: 'Sprint',             desc: 'Branch name, PR title, PR description from ticket',        recommended: false },
  'deploy-checklist': { label: 'Deploy Checklist',  desc: 'Pre/post deploy verification checklist',                   recommended: false },
  'wednesday-dev':    { label: 'Wednesday Dev',     desc: 'Import ordering, complexity limits, naming conventions',   recommended: true },
  'wednesday-design': { label: 'Wednesday Design',  desc: '492+ approved UI components, design tokens, animations',   recommended: false },
};

function promptChecklist(availableSkills) {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('');
    log('cyan', '  Select skills to install:');
    console.log('  (Enter numbers separated by commas, or "all" for everything)\n');

    availableSkills.forEach((skill, i) => {
      const meta = SKILL_META[skill] || { label: skill, desc: '', recommended: false };
      const tag = meta.recommended ? colors.green(' [recommended]') : '';
      console.log(`  ${colors.cyan(String(i + 1).padStart(2))}. ${meta.label.padEnd(22)}${meta.desc}${tag}`);
    });

    console.log('');
    rl.question('  Your selection: ', answer => {
      rl.close();
      const input = answer.trim().toLowerCase();
      if (!input || input === 'all') {
        resolve(availableSkills);
        return;
      }
      const indices = input.split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= availableSkills.length);
      const selected = [...new Set(indices)].map(n => availableSkills[n - 1]);
      resolve(selected.length ? selected : availableSkills);
    });
  });
}

function install(targetDir, skipConfig = false, skipChecklist = false) {
  // Resolve to absolute path
  targetDir = path.resolve(targetDir);

  // Check if we're in a project directory
  const projectIndicators = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
  const hasProjectFile = projectIndicators.some(file =>
    fs.existsSync(path.join(targetDir, file))
  );

  if (!hasProjectFile) {
    log('yellow', 'Warning: No package.json, pyproject.toml, Cargo.toml, or go.mod found.');
    log('yellow', 'Installing anyway...');
  }

  // Find the skills directory in the package
  const packageRoot = path.join(__dirname, '..');
  const skillsSource = path.join(packageRoot, 'skills');

  if (!fs.existsSync(skillsSource)) {
    log('red', 'Error: Skills not found in package. Please reinstall.');
    process.exit(1);
  }

  const availableSkills = fs.readdirSync(skillsSource)
    .filter(s => fs.statSync(path.join(skillsSource, s)).isDirectory());

  // Show checklist unless --all or --skip-config passed
  const doInstall = async (selectedSkills) => {
    // Create .wednesday/skills directory
    const skillsDir = path.join(targetDir, '.wednesday', 'skills');
    log('blue', `\nCreating skills directory: ${skillsDir}`);
    fs.mkdirSync(skillsDir, { recursive: true });

    selectedSkills.forEach(skill => {
      const src = path.join(skillsSource, skill);
      const dest = path.join(skillsDir, skill);
      log('blue', `Installing ${skill} skill...`);
      copyRecursive(src, dest);
      log('green', `  ✓ ${skill} installed`);
    });

    // Copy GitHub Action workflows
    copyGitHubAssets(packageRoot, targetDir);

    // Copy commitlint config
    const commitlintSrc = path.join(packageRoot, '.commitlintrc.json');
    const commitlintDest = path.join(targetDir, '.commitlintrc.json');
    if (fs.existsSync(commitlintSrc) && !fs.existsSync(commitlintDest)) {
      fs.copyFileSync(commitlintSrc, commitlintDest);
      log('green', '  ✓ .commitlintrc.json copied');
    }

    // Write default tools.json
    ensureToolsConfig(targetDir);

    // Check .gitignore
    const gitignorePath = path.join(targetDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      if (!gitignore.includes('.wednesday')) {
        console.log('');
        log('yellow', 'Note: .wednesday is not in your .gitignore');
        log('yellow', "You may want to add it if you don't want to commit the skills:");
        log('blue', "  echo '.wednesday/' >> .gitignore");
        console.log('');
        log('yellow', 'Or keep it tracked to share with your team.');
      }
    }

    console.log('');
    log('green', '╔═══════════════════════════════════════════════════════════╗');
    log('green', '║         Skills installed!                                 ║');
    log('green', '╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    // Configure agents unless skipped
    if (!skipConfig) {
      console.log('');
      log('blue', 'Configuring AI agents to discover skills...');
      console.log('');
      configure(targetDir, 'all');
    }

    // Final summary
    console.log('');
    log('blue', `Skills location: ${skillsDir}`);
    console.log('');
    log('cyan', 'Configured agents:');
    console.log('  • Claude Code    → CLAUDE.md');
    console.log('  • Gemini CLI     → GEMINI.md');
    console.log('  • Cursor         → .cursorrules');
    console.log('  • GitHub Copilot → .github/copilot-instructions.md');
    console.log('');
  };

  if (skipChecklist) {
    doInstall(availableSkills).catch(e => { console.error(e.message); process.exit(1); });
  } else {
    promptChecklist(availableSkills).then(doInstall).catch(e => { console.error(e.message); process.exit(1); });
  }
}

function configure(targetDir, agent = 'all') {
  targetDir = path.resolve(targetDir);
  const skillsDir = path.join(targetDir, '.wednesday', 'skills');

  // Check if skills are installed
  if (!fs.existsSync(skillsDir)) {
    log('red', 'Error: Skills not installed. Run "wednesday-skills install" first.');
    process.exit(1);
  }

  // Get installed skills metadata
  const skills = getInstalledSkills(skillsDir);
  if (skills.length === 0) {
    log('red', 'Error: No valid skills found in .wednesday/skills/');
    process.exit(1);
  }

  const instructions = generateInstructions(skills, targetDir);
  const agents = agent === 'all' ? ['claude', 'gemini', 'cursor', 'copilot'] : [agent];

  for (const agentType of agents) {
    switch (agentType) {
      case 'claude':
        configureClaudeCode(targetDir, instructions);
        break;
      case 'gemini':
        configureGemini(targetDir, instructions);
        break;
      case 'cursor':
        configureCursor(targetDir, instructions);
        break;
      case 'copilot':
        configureGitHubCopilot(targetDir, instructions);
        break;
      default:
        log('yellow', `Unknown agent: ${agentType}`);
    }
  }
}

function configureClaudeCode(targetDir, instructions) {
  const claudeFile = path.join(targetDir, 'CLAUDE.md');

  let content = '';
  const marker = '<!-- WEDNESDAY_SKILLS_START -->';
  const endMarker = '<!-- WEDNESDAY_SKILLS_END -->';
  const wrappedInstructions = `${marker}\n${instructions}\n${endMarker}`;

  if (fs.existsSync(claudeFile)) {
    content = fs.readFileSync(claudeFile, 'utf8');
    // Check if we already have our section
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing section
      content = content.slice(0, startIdx) + wrappedInstructions + content.slice(endIdx + endMarker.length);
    } else {
      // Append to end
      content = content.trim() + '\n\n' + wrappedInstructions;
    }
  } else {
    content = `# Project Guidelines\n\n${wrappedInstructions}`;
  }

  fs.writeFileSync(claudeFile, content);
  log('green', '  ✓ Claude Code configured (CLAUDE.md)');
}

function configureGemini(targetDir, instructions) {
  const geminiFile = path.join(targetDir, 'GEMINI.md');

  let content = '';
  const marker = '<!-- WEDNESDAY_SKILLS_START -->';
  const endMarker = '<!-- WEDNESDAY_SKILLS_END -->';
  const wrappedInstructions = `${marker}\n${instructions}\n${endMarker}`;

  if (fs.existsSync(geminiFile)) {
    content = fs.readFileSync(geminiFile, 'utf8');
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + wrappedInstructions + content.slice(endIdx + endMarker.length);
    } else {
      content = content.trim() + '\n\n' + wrappedInstructions;
    }
  } else {
    content = `# Gemini Project Guidelines\n\n${wrappedInstructions}`;
  }

  fs.writeFileSync(geminiFile, content);
  log('green', '  ✓ Gemini CLI configured (GEMINI.md)');
}

function copyGitHubAssets(packageRoot, targetDir) {
  const assetsDir = path.join(packageRoot, 'assets', 'workflows');
  if (!fs.existsSync(assetsDir)) return;

  const githubWorkflowsDir = path.join(targetDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });

  const files = fs.readdirSync(assetsDir);
  files.forEach(file => {
    const src = path.join(assetsDir, file);
    const dest = path.join(githubWorkflowsDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      log('green', `  ✓ .github/workflows/${file} copied`);
    }
  });
}

function configureCursor(targetDir, instructions) {
  const cursorFile = path.join(targetDir, '.cursorrules');

  let content = '';
  const marker = '# WEDNESDAY_SKILLS_START';
  const endMarker = '# WEDNESDAY_SKILLS_END';
  const wrappedInstructions = `${marker}\n${instructions}\n${endMarker}`;

  if (fs.existsSync(cursorFile)) {
    content = fs.readFileSync(cursorFile, 'utf8');
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + wrappedInstructions + content.slice(endIdx + endMarker.length);
    } else {
      content = content.trim() + '\n\n' + wrappedInstructions;
    }
  } else {
    content = wrappedInstructions;
  }

  fs.writeFileSync(cursorFile, content);
  log('green', '  ✓ Cursor configured (.cursorrules)');
}

function configureGitHubCopilot(targetDir, instructions) {
  const githubDir = path.join(targetDir, '.github');
  const copilotFile = path.join(githubDir, 'copilot-instructions.md');

  // Create .github directory if it doesn't exist
  if (!fs.existsSync(githubDir)) {
    fs.mkdirSync(githubDir, { recursive: true });
  }

  let content = '';
  const marker = '<!-- WEDNESDAY_SKILLS_START -->';
  const endMarker = '<!-- WEDNESDAY_SKILLS_END -->';
  const wrappedInstructions = `${marker}\n${instructions}\n${endMarker}`;

  if (fs.existsSync(copilotFile)) {
    content = fs.readFileSync(copilotFile, 'utf8');
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + wrappedInstructions + content.slice(endIdx + endMarker.length);
    } else {
      content = content.trim() + '\n\n' + wrappedInstructions;
    }
  } else {
    content = `# GitHub Copilot Instructions\n\n${wrappedInstructions}`;
  }

  fs.writeFileSync(copilotFile, content);
  log('green', '  ✓ GitHub Copilot configured (.github/copilot-instructions.md)');
}

function showHelp() {
  console.log('Usage: wednesday-skills [command] [options]');
  console.log('');
  console.log('Commands:');
  console.log('  install [dir]                Install skills and configure agents');
  console.log('  install [dir] --skip-config  Install skills without agent configuration');
  console.log('  configure [dir] [agent]      Configure agents (claude|gemini|cursor|copilot|all)');
  console.log('  sync [dir] [--tool <name>]   Re-sync all adapters or a specific tool');
  console.log('  dashboard [--pr <number>]    Launch terminal dashboard');
  console.log('  plan [dir] [--brief "..."]   Run greenfield parallel persona planning');
  console.log('  pr                           Validate, pre-push check, and create a PR');
  console.log('  list                         List available skills');
  console.log('  help                         Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx @wednesday-solutions-eng/ai-agent-skills install');
  console.log('  wednesday-skills install ./my-project');
  console.log('  wednesday-skills configure . gemini');
  console.log('  wednesday-skills sync --tool antigravity');
  console.log('  wednesday-skills dashboard');
  console.log('  wednesday-skills dashboard --pr 142');
  console.log('  wednesday-skills plan');
  console.log('  wednesday-skills plan --brief "Build a todo app with auth"');
  console.log('');
  console.log('Agent Configuration Files:');
  console.log('  Claude Code    → CLAUDE.md');
  console.log('  Gemini CLI     → GEMINI.md');
  console.log('  Antigravity    → ~/.gemini/antigravity/skills/ (file-copy via sync)');
  console.log('  Cursor         → .cursorrules');
  console.log('  GitHub Copilot → .github/copilot-instructions.md');
  console.log('');
}

function listSkills() {
  log('blue', 'Available skills:');
  console.log('');
  console.log('  git-os');
  console.log('    Conventional commits, atomic changes, GIT-OS workflow.');
  console.log('    Read before generating any commit message.');
  console.log('');
  console.log('  triage-loop');
  console.log('    Gemini PR review triage and dev-approved fix loop.');
  console.log('');
  console.log('  greenfield');
  console.log('    Parallel persona planning (Architect + PM + Security → PLAN.md).');
  console.log('');
  console.log('  sprint');
  console.log('    Sprint initiation — branch name, PR title, PR description template.');
  console.log('');
  console.log('  deploy-checklist');
  console.log('    Pre-deploy and post-deploy verification checklist.');
  console.log('');
  console.log('  wednesday-dev');
  console.log('    Technical development guidelines (imports, complexity, naming).');
  console.log('');
  console.log('  wednesday-design');
  console.log('    Design & UX guidelines — 492+ approved UI components.');
  console.log('');
}

main();
