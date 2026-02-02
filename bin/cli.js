#!/usr/bin/env node

/**
 * Wednesday Agent Skills CLI
 * Installs agent skills and configures AI agents to discover them
 */

const fs = require('fs');
const path = require('path');

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
    case 'install':
      install(args[1] || process.cwd(), args.includes('--skip-config'));
      break;
    case 'configure':
      configure(args[1] || process.cwd(), args[2]);
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

function install(targetDir, skipConfig = false) {
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

  // Create .wednesday/skills directory
  const skillsDir = path.join(targetDir, '.wednesday', 'skills');
  log('blue', `Creating skills directory: ${skillsDir}`);
  fs.mkdirSync(skillsDir, { recursive: true });

  // Copy each skill
  const skillFolders = fs.readdirSync(skillsSource);
  skillFolders.forEach(skill => {
    const src = path.join(skillsSource, skill);
    const dest = path.join(skillsDir, skill);

    if (fs.statSync(src).isDirectory()) {
      log('blue', `Installing ${skill} skill...`);
      copyRecursive(src, dest);
      log('green', `  ✓ ${skill} installed`);
    }
  });

  // Check .gitignore
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('.wednesday')) {
      console.log('');
      log('yellow', 'Note: .wednesday is not in your .gitignore');
      log('yellow', 'You may want to add it if you don\'t want to commit the skills:');
      log('blue', '  echo \'.wednesday/\' >> .gitignore');
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
  console.log('  • Cursor         → .cursorrules');
  console.log('  • GitHub Copilot → .github/copilot-instructions.md');
  console.log('');
  log('blue', 'Try these prompts with your AI assistant:');
  console.log('  • "Create a shimmer button" → Uses Magic UI component');
  console.log('  • "Add a hero section" → Uses approved patterns');
  console.log('  • "Refactor this function" → Applies complexity guidelines');
  console.log('');
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
  const agents = agent === 'all' ? ['claude', 'cursor', 'copilot'] : [agent];

  for (const agentType of agents) {
    switch (agentType) {
      case 'claude':
        configureClaudeCode(targetDir, instructions);
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
  console.log('  install [dir]           Install skills and configure agents (default: current dir)');
  console.log('  install [dir] --skip-config   Install skills without agent configuration');
  console.log('  configure [dir] [agent] Configure agents to discover installed skills');
  console.log('                          Agents: claude, cursor, copilot, all (default: all)');
  console.log('  list                    List available skills');
  console.log('  help                    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx @wednesday-solutions-eng/ai-agent-skills install');
  console.log('  npx @wednesday-solutions-eng/ai-agent-skills install ./my-project');
  console.log('  npx @wednesday-solutions-eng/ai-agent-skills configure . claude');
  console.log('  wednesday-skills install');
  console.log('  wednesday-skills configure');
  console.log('');
  console.log('Agent Configuration Files:');
  console.log('  Claude Code    → CLAUDE.md');
  console.log('  Cursor         → .cursorrules');
  console.log('  GitHub Copilot → .github/copilot-instructions.md');
  console.log('');
}

function listSkills() {
  log('blue', 'Available skills:');
  console.log('');
  console.log('  wednesday-dev');
  console.log('    Technical development guidelines for Wednesday Solutions projects.');
  console.log('    - Import ordering rules');
  console.log('    - Cyclomatic complexity limits (max 8)');
  console.log('    - Naming conventions (PascalCase, camelCase, UPPER_SNAKE_CASE)');
  console.log('');
  console.log('  wednesday-design');
  console.log('    Design & UX guidelines for Wednesday Solutions projects.');
  console.log('    - 492+ approved UI components from 8 vetted libraries');
  console.log('    - Design tokens (colors, typography, spacing, shadows)');
  console.log('    - Animation patterns and easing functions');
  console.log('    - Component styling patterns');
  console.log('');
}

main();
