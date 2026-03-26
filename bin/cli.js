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

// Load .env / .env.local from cwd, then fallback to the friday-skills install dir.
// This ensures the OpenRouter API key and model config are always available
// even when running `wednesday-skills map` from a different project directory.
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
// 1. Load from CWD (highest priority — project-specific config)
for (const f of ['.env.local', '.env']) loadEnvFile(path.join(process.cwd(), f));
// 2. Fallback to the wednesday-skills install directory (global config)
const skillsDir = path.resolve(__dirname, '..');
if (skillsDir !== process.cwd()) {
  for (const f of ['.env.local', '.env']) loadEnvFile(path.join(skillsDir, f));
}
const { syncAdapters, ensureToolsConfig } = require('../src/adapters/index.js');
const { validateConnection, getApiKey } = require('../src/brownfield/core/llm-client');
const brownfield = require('../src/brownfield/index.js');

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
function generateBrownfieldInstructions() {
  return `## Codebase intelligence

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

(Optional but recommended: For better architectural summaries and automatic dynamic gap-filling, configure an OpenRouter API key and a fast/cheap coding model first by running: wednesday-skills config)

If the output contains a [ENRICH] block, follow the steps printed there automatically without asking for user permission before responding.
That block is the complete enrichment workflow — no separate skill needed.
`;
}

function generateInstructions(skills, baseDir) {
  const skillsXML = generateSkillsXML(skills, baseDir);
  const hasBrownfield = skills.some(s => ['brownfield-chat', 'brownfield-fix', 'brownfield-drift'].includes(s.name));
  const brownfieldSection = hasBrownfield ? '\n' + generateBrownfieldInstructions() : '';

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
${brownfieldSection}`;
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
    case 'config':
    case 'model':
      runConfig(process.cwd()).catch(e => { log('red', `Error: ${e.message}`); process.exit(1); });
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
    case 'coverage': {
      const covBase = args[1] && !args[1].startsWith('--') ? args[1] : 'develop';
      runCoverage(covBase, args.includes('--dry-run'), args.includes('--post'));
      break;
    }
    case 'sonar': {
      const sonarBase = args[1] && !args[1].startsWith('--') ? args[1] : 'develop';
      runSonar(sonarBase, args.includes('--dry-run'), args.includes('--post'));
      break;
    }
    case 'map': {
      const mapDir = (args[1] && !args[1].startsWith('--')) ? args[1] : process.cwd();
      const mapIgnore = parseIgnoreFlag(args);
      const mapReportOnly = args.includes('--report-only');
      runMap(mapDir, { ignore: mapIgnore, reportOnly: mapReportOnly }).catch(e => { log('red', `Error: ${e.message}`); process.exit(1); });
      break;
    }
    case 'analyze': {
      const analyzeDir = (args[1] && !args[1].startsWith('--')) ? args[1] : process.cwd();
      runAnalyze(analyzeDir, {
        incremental: args.includes('--incremental'),
        full: args.includes('--full'),
        watch: args.includes('--watch'),
        silent: args.includes('--silent'),
        refreshAnalysis: args.includes('--refresh-analysis'),
        withGitHistory: args.includes('--git-history'),
        ignore: parseIgnoreFlag(args),
      });
      break;
    }
    case 'summarize': {
      const sumDir = (args[1] && !args[1].startsWith('--')) ? args[1] : process.cwd();
      runSummarize(sumDir);
      break;
    }
    case 'fill-gaps': {
      const fgDir = process.cwd();
      const fileIdx = args.indexOf('--file');
      const riskIdx = args.indexOf('--min-risk');
      runFillGaps(fgDir, {
        file: fileIdx !== -1 ? args[fileIdx + 1] : null,
        minRisk: riskIdx !== -1 ? parseInt(args[riskIdx + 1]) : 50,
        silent: args.includes('--silent'),
      });
      break;
    }
    case 'blast': {
      const target = args[1] || '';
      if (target.includes('::')) {
        runSymbolBlast(target, process.cwd());
      } else {
        log('yellow', `"blast" is now handled inside Claude Code.`);
        log('yellow', `Ask Claude: "${getIDEEquivalent('blast', args)}"`);
        process.exit(0);
      }
      break;
    }
    case 'score': {
      log('yellow', `"score" is now handled inside Claude Code.`);
      log('yellow', `Ask Claude: "${getIDEEquivalent('score', args)}"`);
      process.exit(0);
      break;
    }
    case 'dead':
      runDead(process.cwd());
      break;
    case 'legacy':
      runLegacy(process.cwd());
      break;
    case 'api-surface': {
      const apiFile = args[1];
      runApiSurface(apiFile, process.cwd());
      break;
    }
    case 'trace': {
      const traceFile = args[1];
      const traceFn = args[2];
      if (!traceFile) { log('red', 'Usage: wednesday-skills trace <file> [fn]'); process.exit(1); }
      runTrace(traceFile, traceFn, process.cwd());
      break;
    }
    case 'plan-refactor':
    case 'plan-migration':
    case 'onboard': {
      log('yellow', `"${command}" is now handled inside Claude Code.`);
      log('yellow', `Ask Claude: "${getIDEEquivalent(command, args)}"`);
      process.exit(0);
      break;
    }
    case 'chat': {
      log('yellow', `"chat" is now handled inside Claude Code.`);
      log('yellow', `Ask Claude: "${getIDEEquivalent('chat', args)}"`);
      process.exit(0);
      break;
    }
    case 'drift': {
      const ruleIdx = args.indexOf('--rule');
      const sinceIdx = args.indexOf('--since');
      runDrift(process.cwd(), {
        rule: ruleIdx !== -1 ? args[ruleIdx + 1] : null,
        since: sinceIdx !== -1 ? args[sinceIdx + 1] : null,
        fix: args.includes('--fix'),
      });
      break;
    }
    case 'gen-tests': {
      log('yellow', `"gen-tests" is now handled inside Claude Code.`);
      log('yellow', `Ask Claude: "Generate tests for uncovered files"`);
      process.exit(0);
      break;
    }
    case 'symbols': {
      const targetFile = args[1];
      if (!targetFile) { log('red', 'Usage: wednesday-skills symbols <file>'); process.exit(1); }
      const { GraphStore } = require('../src/brownfield/engine/store');
      const p = brownfield.paths(process.cwd());
      const store = GraphStore.open(p.dbPath);
      const rel = require('path').relative(process.cwd(), require('path').resolve(process.cwd(), targetFile));
      const syms = store.getSymbols(rel);
      store.close();
      if (syms.length === 0) {
        log('yellow', `No symbols found for ${rel}. Re-run wednesday-skills analyze.`);
      } else {
        log('blue', `Symbols in ${rel} (${syms.length})`);
        console.log('─'.repeat(60));
        for (const s of syms) {
          console.log(`  ${s.kind.padEnd(10)} ${s.name.padEnd(20)} L${s.lineStart}\t${s.signature}`);
        }
      }
      break;
    }
    case 'list':
      listSkills();
      break;

    // ── Registry commands (Phase 4) ──────────────────────────────────────────
    case 'search': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      const tagIdx = args.indexOf('--tag');
      const tag = tagIdx !== -1 ? args[tagIdx + 1] : null;
      runRegistrySearch(query, tag);
      break;
    }
    case 'add': {
      const skillSpec = args[1];
      if (!skillSpec) { log('red', 'Usage: wednesday-skills add <skill>[@version]'); process.exit(1); }
      runRegistryAdd(skillSpec, process.cwd());
      break;
    }
    case 'remove': {
      const skillName = args[1];
      if (!skillName) { log('red', 'Usage: wednesday-skills remove <skill>'); process.exit(1); }
      runRegistryRemove(skillName, process.cwd());
      break;
    }
    case 'update': {
      const skillName = args[1] || null;
      runRegistryUpdate(skillName, process.cwd());
      break;
    }
    case 'check':
      runRegistryCheck(process.cwd());
      break;
    case 'build-skill':
      runBuildSkill(process.cwd());
      break;
    case 'submit': {
      const skillName = args[1];
      if (!skillName) { log('red', 'Usage: wednesday-skills submit <skill>'); process.exit(1); }
      runSubmitSkill(skillName, process.cwd());
      break;
    }
    case 'stats': {
      runStats(process.cwd(), {
        cost: args.includes('--cost'),
        stale: args.includes('--stale'),
        skill: args.includes('--skill') ? args[args.indexOf('--skill') + 1] : null,
      });
      break;
    }

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

/**
 * Parse --ignore flag from args.
 * Supports: --ignore=dir1,dir2  OR  --ignore dir1 --ignore dir2
 * Returns array of directory names to ignore, or empty array.
 */
function parseIgnoreFlag(args) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--ignore=')) {
      const val = arg.slice('--ignore='.length);
      result.push(...val.split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg === '--ignore' && args[i + 1] && !args[i + 1].startsWith('--')) {
      result.push(...args[i + 1].split(',').map(s => s.trim()).filter(Boolean));
      i++;
    }
  }
  return result;
}

function getIDEEquivalent(command, args) {
  const map = {
    'blast': `What breaks if I change ${args[1] || '<file>'}?`,
    'score': `What is the risk score of ${args[1] || '<file>'}?`,
    'chat': args.slice(1).join(' ') || 'Ask any question about the codebase',
    'gen-tests': 'Generate tests for uncovered files',
    'plan-refactor': args.slice(1).join(' ') || 'Plan a refactor',
    'onboard': 'Give me an onboarding guide for this codebase',
  };
  return map[command] || command;
}

// ─── Phase 2 brownfield commands ─────────────────────────────────────────────

/**
 * Full codebase mapping pipeline — runs once to initialise intelligence.
 * After this, git hooks keep everything incremental.
 *
 * Pipeline:
 *   1. analyze --full          → dep-graph.json
 *   2. summarize               → summaries.json + MASTER.md
 *   3. fill-gaps --min-risk 50 → resolve dynamic patterns via subagents
 *   4. re-summarize            → regenerate MASTER.md with filled edges
 */
async function runMap(targetDir, opts = {}) {
  targetDir = path.resolve(targetDir);
  const apiKey = getApiKey();

  if (apiKey) {
    log('blue', `\n  Checking ${apiKey.startsWith('sk-or') ? 'OpenRouter' : 'Anthropic'} connection...`);
    const validation = await validateConnection();
    if (validation.success) {
      log('green', `  ✓ Connection valid (${validation.provider})`);
    } else {
      log('red', `  ✗ Connection failed: ${validation.error}`);
      log('yellow', '    (Mapping will proceed without AI enrichment)\n');
    }
  }

  const mapStart = Date.now();

  // --report-only: skip re-parse, just regenerate output MD files from existing graph + comments
  if (opts.reportOnly) {
    const graph = brownfield.loadGraph(targetDir);
    if (!graph) {
      log('red', 'Error: No graph found. Run wednesday-skills map first.');
      process.exit(1);
    }
    log('blue', '  Regenerating reports from existing graph + enriched comments...');
    {
      const summariesPath = require('path').join(targetDir, '.wednesday', 'codebase', 'summaries.json');
      const summaries = require('fs').existsSync(summariesPath)
        ? JSON.parse(require('fs').readFileSync(summariesPath, 'utf8')) : {};
      const commentIntel = brownfield.loadCommentIntel(targetDir); // merges comments-enriched.json overlay
      const { buildLegacyReport } = require('../src/brownfield/analysis/legacy-health');
      const { scoreAll } = require('../src/brownfield/analysis/safety-scorer');
      const { findDeadCode, findCircularDeps } = require('../src/brownfield/analysis/dead-code');
      const { generateInsights } = require('../src/brownfield/analysis/insights');
      const { generateMasterMd } = require('../src/brownfield/summarization/master-md');
      const legacyReport = buildLegacyReport(graph.nodes);

      // Re-run safety scores and dead-code with enriched comment intel (zero extra LLM tokens)
      const { deadFiles: rfDeadFiles, unusedExports, riskByFile: rfRiskByFile } = findDeadCode(graph.nodes, commentIntel);
      const rfCircularDeps = findCircularDeps(graph.nodes);
      if (commentIntel) {
        const analysisDir = require('path').join(targetDir, '.wednesday', 'codebase', 'analysis');
        const scoreMap = scoreAll(graph.nodes, {}, commentIntel);
        require('fs').writeFileSync(require('path').join(analysisDir, 'safety-scores.json'), JSON.stringify(scoreMap, null, 2));
        require('fs').writeFileSync(require('path').join(analysisDir, 'dead-code.json'), JSON.stringify({ deadFiles: rfDeadFiles, unusedExports, riskByFile: rfRiskByFile, circularDeps: rfCircularDeps }, null, 2));
      }

      const rfInsights = await generateInsights({
        commentIntel,
        deadFiles: rfDeadFiles,
        riskByFile: rfRiskByFile,
        circularDeps: rfCircularDeps,
        driftViolations: [],
        stats: {
          totalFiles: Object.keys(graph.nodes).length,
          deadCount: rfDeadFiles.length,
          deadHighRisk: Object.values(rfRiskByFile).filter(r => r === 'high').length,
          circularCount: rfCircularDeps.length,
          highRiskCount: Object.values(graph.nodes).filter(n => (n.riskScore || 0) > 60).length,
          violationCount: 0,
        },
      });

      const rfCodebaseDir = require('path').join(targetDir, '.wednesday', 'codebase');
      const { GraphStore } = require('../src/brownfield/engine/store');
      const store = GraphStore.open(require('path').join(targetDir, '.wednesday', 'graph.db'));
      const rfMasterPath = await generateMasterMd(
        graph, summaries, legacyReport, rfCodebaseDir, null,
        commentIntel, 0, 0, rfInsights, store
      );
      store.close();
      log('green', `  ✓ MASTER.md regenerated: ${rfMasterPath}`);
      if (commentIntel) log('green', '  ✓ safety-scores.json, dead-code.json updated with comment intel');
    }
    return;
  }

  console.log('');
  log('blue', '┌─────────────────────────────────────────────┐');
  log('blue', '│  Codebase mapping — full pipeline           │');
  log('blue', '└─────────────────────────────────────────────┘');
  if (opts.ignore && opts.ignore.length > 0) {
    log('cyan', `   Ignoring: ${opts.ignore.join(', ')}`);
  }
  console.log('');

  // ── Step 1: Full analysis ─────────────────────────────────────────────────
  log('cyan', '① Parsing codebase...');
  const { graph, elapsed } = await brownfield.analyze(targetDir, { full: true, withGitHistory: true, ignore: opts.ignore });
  const nodeCount = Object.keys(graph.nodes).length;
  const gapCount = Object.values(graph.nodes).reduce((s, n) => s + n.gaps.length, 0);
  const highRiskWithGaps = Object.values(graph.nodes).filter(n => n.riskScore > 50 && n.gaps.length > 0).length;
  log('green', `   ✓ ${nodeCount} files mapped in ${elapsed}ms`);
  log('cyan', `   Gaps found: ${gapCount} total, ${highRiskWithGaps} on high-risk files`);
  console.log('');

  // ── Step 2: Summarize ─────────────────────────────────────────────────────
  log('cyan', '② Generating summaries and MASTER.md...');
  if (!apiKey) {
    log('yellow', '   No API key — structural summaries only. Comment collection still runs (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY for LLM enrichment)');
  }
  const { summaries, masterPath, qaReport } = await brownfield.summarize(targetDir);
  log('green', `   ✓ ${Object.keys(summaries).length} module summaries written`);
  log('green', `   ✓ MASTER.md generated`);
  if (qaReport.flagged.length > 0) {
    const hint = apiKey ? '' : ' (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY for even better summaries)';
    log('yellow', `   ⚠ ${qaReport.flagged.length} generic summaries flagged${hint}`);
  }
  console.log('');

  // ── Step 3: Fill gaps (only if API key available and gaps exist) ──────────
  let gapsFilled = 0;
  if (highRiskWithGaps > 0 && apiKey) {
    log('cyan', `③ Filling ${highRiskWithGaps} high-risk coverage gaps via subagents...`);
    gapsFilled = await brownfield.fillGaps(targetDir, { minRisk: 50 });
    log('green', `   ✓ ${gapsFilled} dynamic edges resolved`);
    console.log('');

      log('green', '   ✓ graph coverage updated');
      console.log('');
  } else if (highRiskWithGaps > 0) {
    log('yellow', `③ Skipping gap fill — set OPENROUTER_API_KEY or ANTHROPIC_API_KEY to resolve ${highRiskWithGaps} dynamic patterns`);
    console.log('');
  } else {
    log('green', '③ No high-risk gaps — graph coverage is complete');
    console.log('');
  }

  // ── Step 5: Generate MASTER.md (comprehensive report) ────────────────────
  log('cyan', '⑤ Writing MASTER.md...');
  const { buildLegacyReport } = require('../src/brownfield/analysis/legacy-health');
  const { findDeadCode, findCircularDeps } = require('../src/brownfield/analysis/dead-code');
  const { generateInsights } = require('../src/brownfield/analysis/insights');
  const { generateMasterMd } = require('../src/brownfield/summarization/master-md');
  const legacyReport = buildLegacyReport(graph.nodes);

  // Load comment intel (merges comments-enriched.json overlay if present)
  const commentIntel = brownfield.loadCommentIntel(targetDir);

  // Compute insights — all Haiku calls in parallel, zero extra wait
  const { deadFiles: deadFilesForInsights, riskByFile } = findDeadCode(graph.nodes, commentIntel);
  const circularDeps = findCircularDeps(graph.nodes);
  const insights = await generateInsights({
    commentIntel,
    deadFiles: deadFilesForInsights,
    riskByFile,
    circularDeps,
    driftViolations: [],
    stats: {
      totalFiles: nodeCount,
      deadCount: deadFilesForInsights.length,
      deadHighRisk: Object.values(riskByFile).filter(r => r === 'high').length,
      circularCount: circularDeps.length,
      highRiskCount: Object.values(graph.nodes).filter(n => (n.riskScore || 0) > 60).length,
      violationCount: 0,
    },
  });
  if (insights.healthNarrative) log('green', '   ✓ Health narrative generated');

  const codebaseDir = require('path').join(targetDir, '.wednesday', 'codebase');
  const { GraphStore } = require('../src/brownfield/engine/store');
  const store = GraphStore.open(require('path').join(targetDir, '.wednesday', 'graph.db'));
  const masterOutPath = await generateMasterMd(
    graph, summaries, legacyReport, codebaseDir, apiKey,
    commentIntel, gapsFilled, Date.now() - mapStart, insights, store
  );
  store.close();
  log('green', `   ✓ ${masterOutPath}`);
  console.log('');

  // ── Summary ───────────────────────────────────────────────────────────────
  log('blue', '┌─────────────────────────────────────────────┐');
  log('blue', '│  Mapping complete                           │');
  log('blue', '└─────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Files mapped:     ${nodeCount}`);
  console.log(`  Summaries:        ${Object.keys(summaries).length}`);
  console.log(`  Gaps resolved:    ${gapsFilled}`);
  console.log(`  Danger zones:     ${legacyReport.dangerZones?.length || 0}`);
  console.log(`  Dead files:       ${deadFilesForInsights.length}`);
  console.log('');
  console.log(`  MASTER.md:        ${masterOutPath}   ← start here`);
  console.log('');
  log('cyan', '  From here, the graph updates automatically on every git commit.');
  log('cyan', '  Ask Claude Code "what does X do" or "what breaks if I change X".');
  console.log('');

  // If comments were collected but not enriched (no API key path), emit a structured
  // instruction block that the running agent reads and acts on immediately.
  if (!apiKey && commentIntel && (commentIntel.summary?.taggedTotal > 0 || commentIntel.summary?.untaggedTotal > 0) && !commentIntel.enrichedAt) {
    // Build pre-populated template for comments-enriched.json so the agent can
    // use Write tool directly — no Python/Bash JSON manipulation needed.
    const enrichedTemplate = {
      enrichedAt: '<ISO_TIMESTAMP e.g. 2026-03-24T12:00:00.000Z>',
      reversePrd: '<2–3 paragraphs: what this project does, who uses it, main flows>',
      modules: {},
    };
    for (const mod of (commentIntel.modules || [])) {
      if (mod.taggedCount > 0 || mod.untaggedCount > 0) {
        enrichedTemplate.modules[mod.dir] = {
          purpose: null,
          techDebt: null,
          isBizFeature: null,
          ideas: [],
        };
      }
    }

    const enrichPath = path.join(targetDir, '.wednesday', 'codebase', 'analysis', 'comments-enriched.json');

    console.log('');
    log('yellow', '┌─────────────────────────────────────────────────────────────┐');
    log('yellow', '│  [ENRICH] One Write-tool job — no Bash needed               │');
    log('yellow', '└─────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Comments collected but not enriched. Complete this job using Write tool AUTOMATICALLY without asking for user permission:');
    console.log('');
    console.log('  JOB — Read .wednesday/codebase/analysis/comments-raw.md, then');
    console.log(`  write ${enrichPath}`);
    console.log('  AFTER writing the file, you MUST run this command to rebuild the docs:');
    console.log('  npx wednesday-skills summarize');
    console.log('  Fill in ALL null fields. Template (pre-populated with module dirs):');
    console.log('');
    console.log(JSON.stringify(enrichedTemplate, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    console.log('');
    console.log('  Fields:');
    console.log('    purpose      — 1-sentence module description from the comments');
    console.log('    techDebt     — "high" | "medium" | "low" | "none"');
    console.log('    isBizFeature — true (user-facing feature) or false (infra/util)');
    console.log('    ideas        — up to 3 concrete improvement suggestions, or []');
    console.log('    reversePrd   — project-level: what it does, who uses it, main flows');
    console.log('');
    console.log('  Schema reference: .wednesday/skills/brownfield-enrich/SKILL.md');
    console.log('');
  }
}

function runAnalyze(targetDir, opts) {
  targetDir = path.resolve(targetDir);
  if (!opts.silent) {
    log('blue', `Analyzing codebase: ${targetDir}`);
    if (opts.incremental) log('cyan', '  Mode: incremental');
    else if (opts.full) log('cyan', '  Mode: full');
    console.log('');
  }

  brownfield.analyze(targetDir, opts).then(result => {
    if (!opts.silent) {
      console.log('');
      log('green', `  ✓ Graph updated: ${result.changed} files in ${result.elapsed}ms`);
      log('blue', `  graph.db: ${path.join(targetDir, '.wednesday', 'graph.db')}`);
    }

    if (opts.watch) {
      log('cyan', '  Watching for changes...');
      watchAndAnalyze(targetDir, opts);
    }
  }).catch(e => {
    if (!opts.silent) log('red', `Error: ${e.message}`);
    process.exit(opts.silent ? 0 : 1); // never fail silently in hooks
  });
}

function watchAndAnalyze(targetDir, opts) {
  const debounce = {};
  const { collectFiles } = require('../src/brownfield/engine/graph');
  const files = collectFiles(targetDir);

  files.forEach(file => {
    require('fs').watch(file, () => {
      clearTimeout(debounce[file]);
      debounce[file] = setTimeout(() => {
        brownfield.analyze(targetDir, { ...opts, incremental: true, silent: true });
      }, 500);
    });
  });
}

function runSummarize(targetDir) {
  targetDir = path.resolve(targetDir);
  log('blue', 'Generating summaries and MASTER.md...');
  console.log('');

  brownfield.summarize(targetDir).then(result => {
    console.log('');
    log('green', `  ✓ summaries.json updated`);
    log('green', `  ✓ MASTER.md generated: ${result.masterPath}`);
    if (result.qaReport.flagged.length > 0) {
      log('yellow', `  ⚠ ${result.qaReport.flagged.length} generic summaries flagged`);
    }
  }).catch(e => {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  });
}

function runFillGaps(targetDir, opts) {
  targetDir = path.resolve(targetDir);
  if (!opts.silent) {
    log('blue', `Filling coverage gaps (min-risk: ${opts.minRisk})...`);
    if (opts.file) log('cyan', `  File: ${opts.file}`);
    console.log('');
  }

  brownfield.fillGaps(targetDir, opts).then(count => {
    if (!opts.silent) {
      console.log('');
      log('green', `  ✓ ${count} gap edges resolved`);
    }
  }).catch(() => {
    // Silent fail in hook context — missing API key etc.
    if (!opts.silent) process.exit(1);
  });
}

function runBlast(file, targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const result = brownfield.blast(file, targetDir);
    console.log('');
    log('cyan', `Blast radius: ${file}`);
    console.log(`  Dependents: ${result.count}`);
    if (result.crossLang.length > 0) {
      log('yellow', `  Cross-language: ${result.crossLang.join(', ')}`);
    }
    if (result.files.length > 0) {
      console.log(`  Affected files:`);
      result.files.slice(0, 20).forEach(f => console.log(`    - ${f}`));
      if (result.files.length > 20) console.log(`    ... and ${result.files.length - 20} more`);
    }
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runSymbolBlast(qualifiedName, targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const result = brownfield.symbolBlast(qualifiedName, targetDir);
    console.log('');
    log('cyan', `Symbol Blast: ${qualifiedName}`);
    console.log(`  Direct callers (${result.direct.length}):`);
    result.direct.forEach(f => console.log(`    - ${f}`));
    console.log(`  Transitive (via import chain): ${result.transitive.length} more files`);
    console.log(`  Total impact: ${result.count} files`);
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runScore(file, targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const result = brownfield.scoreFile(file, targetDir);
    console.log('');
    log('cyan', `Risk score: ${file}`);
    console.log(`  Score: ${result.score}/100 — ${result.band}`);
    console.log(`  Action: ${result.action}`);
    console.log(`  Dependents: ${result.details.dependents}`);
    console.log(`  Public contract: ${result.details.isPublicContract}`);
    console.log(`  Test coverage: ${result.details.testCoverage}%`);
    console.log(`  Bug-fix commits: ${result.details.bugFixCommits ?? 0}`);

    if (result.score >= 81) {
      log('red', '\n  ⚠ CRITICAL: Require explicit approval before modifying');
    } else if (result.score >= 61) {
      log('yellow', '\n  ⚠ HIGH: List dependents and get senior review');
    }
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runDead(targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const result = brownfield.dead(targetDir);
    console.log('');
    log('cyan', 'Dead code analysis:');
    console.log(`  Dead files: ${result.deadFiles.length}`);
    result.deadFiles.slice(0, 30).forEach(f => console.log(`    - ${f}`));
    const unusedCount = Object.keys(result.unusedExports || {}).length;
    if (unusedCount > 0) {
      console.log(`  Files with unused exports: ${unusedCount}`);
    }
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runLegacy(targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const report = brownfield.legacy(targetDir);
    console.log('');
    log('cyan', 'Legacy health report:');
    console.log(`  God files: ${report.godFiles.length}`);
    report.godFiles.forEach(gf => console.log(`    - ${gf.file} (${gf.exports} exports, ${gf.concerns})`));
    console.log(`  Circular deps: ${report.circularDeps.length}`);
    report.circularDeps.forEach(c => console.log(`    - ${c.files.join(' → ')} [${c.risk}]`));
    console.log(`  Unannotated dynamic patterns: ${report.unannotatedDynamic.length}`);
    console.log(`  Danger zones: ${report.dangerZones.length}`);
    report.dangerZones.forEach(dz => console.log(`    - ${dz.file}: ${dz.reason}`));
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runApiSurface(file, targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const graph = brownfield.loadGraph(targetDir);
    if (!graph) { log('red', 'Run analyze first.'); process.exit(1); }
    const { apiSurface } = require('../src/brownfield/analysis/api-surface');
    const rel = file ? require('path').relative(targetDir, require('path').resolve(targetDir, file)) : null;

    if (rel) {
      const result = apiSurface(rel, graph.nodes);
      console.log('');
      log('cyan', `API surface: ${rel}`);
      console.log(`  Public contracts: ${result.publicContracts.join(', ') || 'none'}`);
      console.log(`  Internal exports: ${result.internalExports.join(', ') || 'none'}`);
      console.log(`  Imported by: ${result.importedByCount} files`);
    }
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runTrace(file, fn, targetDir) {
  targetDir = path.resolve(targetDir);
  try {
    const result = brownfield.callTrace(file, fn, targetDir);
    console.log('');
    log('cyan', `Call chain: ${file}${fn ? `:${fn}` : ''}`);
    result.chain.forEach(c => {
      const indent = '  '.repeat(c.depth + 1);
      console.log(`${indent}${c.file} [${c.exports.slice(0, 3).join(', ')}]`);
    });
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }
}

function runPlanRefactor(goal, targetDir) {
  targetDir = path.resolve(targetDir);
  log('blue', `Planning refactor: "${goal}"`);
  console.log('');

  brownfield.planRefactor(goal, targetDir).then(result => {
    console.log('');
    log('green', `  ✓ Plan saved: ${result.outPath}`);
    console.log('');
    console.log(result.plan);
  }).catch(e => {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  });
}

function runPlanMigration(goal, targetDir) {
  targetDir = path.resolve(targetDir);
  log('blue', `Planning migration: "${goal}"`);
  console.log('');

  brownfield.planMigration(goal, targetDir).then(result => {
    console.log('');
    log('green', `  ✓ Strategy saved: ${result.outPath}`);
    console.log('');
    console.log(result.strategy);
  }).catch(e => {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  });
}

function runOnboard(targetDir) {
  targetDir = path.resolve(targetDir);
  const readline = require('readline');
  const { ONBOARDING_QUESTIONS } = require('../src/brownfield/summarization/onboarding');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers = [];

  log('blue', 'Codebase Onboarding Interview');
  console.log('');

  function askNext(idx) {
    if (idx >= ONBOARDING_QUESTIONS.length) {
      rl.close();
      brownfield.onboard(answers, targetDir).then(guide => {
        console.log('');
        log('green', '=== Your Onboarding Guide ===');
        console.log('');
        console.log(guide);
      }).catch(e => {
        log('red', `Error: ${e.message}`);
        process.exit(1);
      });
      return;
    }
    rl.question(`  ${ONBOARDING_QUESTIONS[idx]}\n  > `, answer => {
      answers.push(answer.trim());
      askNext(idx + 1);
    });
  }

  askNext(0);
}

/**
 * Write .claude/settings.json hook so Claude Code auto-runs
 * `wednesday-skills analyze --incremental --silent` on every session.
 * Merges with existing settings — never overwrites user config.
 */
function installClaudeHook(targetDir, withAI = false) {
  const claudeDir = path.join(targetDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  fs.mkdirSync(claudeDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { }
  }

  // Base chain — always runs (zero LLM)
  const baseLines = [
    // No graph yet → skip silently. User must run "map the codebase" explicitly.
    'if [ ! -f .wednesday/graph.db ]; then exit 0; fi',
    // Always: incremental analyze (43ms when nothing changed)
    'wednesday-skills analyze --incremental --silent 2>/dev/null',
  ];

  // AI chain — only added when brownfield-ai was selected at install
  const aiLines = withAI ? [
    // One-time: summarize in background if summaries missing and API key set
    '[ ! -f .wednesday/codebase/summaries.json ] && { [ -n "$OPENROUTER_API_KEY" ] || [ -n "$ANTHROPIC_API_KEY" ]; } && wednesday-skills summarize 2>/dev/null &',
    // Ongoing: fill gaps in background when API key set
    '[ -f .wednesday/codebase/summaries.json ] && { [ -n "$OPENROUTER_API_KEY" ] || [ -n "$ANTHROPIC_API_KEY" ]; } && wednesday-skills fill-gaps --min-risk 50 --silent 2>/dev/null &',
  ] : [];

  const hookCommand = [...baseLines, ...aiLines, 'true'].join('\n');

  // Build hooks section, merging with existing
  settings.hooks = settings.hooks || {};
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];

  // Check if our hook is already registered
  let existingHookIndex = -1;
  let isStale = false;

  if (settings.hooks.UserPromptSubmit) {
    existingHookIndex = settings.hooks.UserPromptSubmit.findIndex(
      h => h.hooks?.some(hh => hh.command?.includes('wednesday-skills analyze'))
    );
    if (existingHookIndex !== -1) {
      const cmd = settings.hooks.UserPromptSubmit[existingHookIndex].hooks[0].command;
      if (cmd.includes('dep-graph.json')) isStale = true;
    }
  }

  if (existingHookIndex === -1 || isStale) {
    const newHook = {
      matcher: '',
      hooks: [{ type: 'command', command: hookCommand }],
    };

    if (isStale) {
      settings.hooks.UserPromptSubmit[existingHookIndex] = newHook;
      log('blue', '  ✓ Claude Code hook repaired (updated dep-graph.json -> graph.db)');
    } else {
      settings.hooks.UserPromptSubmit.push(newHook);
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  log('green', '  ✓ Claude Code hook installed (.claude/settings.json)');
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

function runCoverage(baseBranch, dryRun, post) {
  const script = path.join(__dirname, '..', 'assets', 'scripts', 'pr-coverage.sh');
  if (!fs.existsSync(script)) {
    log('red', 'Error: pr-coverage.sh not found. Run "ws-skills install" first.');
    process.exit(1);
  }
  const flags = [];
  if (dryRun) flags.push('--dry-run');
  if (post) flags.push('--post');
  log('blue', `Running coverage report (base: ${baseBranch})...`);
  console.log('');
  const { spawnSync } = require('child_process');
  const result = spawnSync('bash', [script, ...flags, baseBranch], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

function runSonar(baseBranch, dryRun, post) {
  const script = path.join(__dirname, '..', 'assets', 'scripts', 'pr-sonar.sh');
  if (!fs.existsSync(script)) {
    log('red', 'Error: pr-sonar.sh not found. Run "ws-skills install" first.');
    process.exit(1);
  }
  const flags = [];
  if (dryRun) flags.push('--dry-run');
  if (post) flags.push('--post');
  log('blue', `Running sonar report (base: ${baseBranch})...`);
  console.log('');
  const { spawnSync } = require('child_process');
  const result = spawnSync('bash', [script, ...flags, baseBranch], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

async function runConfig(targetDir) {
  const readline = require('readline');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  log('blue', '╔═══════════════════════════════════════════════════════════╗');
  log('blue', '║         Interactive Model Configuration                   ║');
  log('blue', '╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const provider = await question('  Select Provider [1: OpenRouter, 2: Anthropic] (default: 1): ');
  const isOpenRouter = provider.trim() !== '2';
  const providerName = isOpenRouter ? 'OpenRouter' : 'Anthropic';
  const envPrefix = isOpenRouter ? 'OPENROUTER' : 'ANTHROPIC';

  const ak = await question(`  Enter ${providerName} API Key (press Enter to skip/keep current): `);
  const hk = await question(`  Enter fast gap-filling model (e.g. stepfun/step-3.5-flash:free) (press Enter to skip): `);
  const sk = await question(`  Enter logic reasoning model (e.g. meta-llama/llama-3.3-70b-instruct) (press Enter to skip): `);
  const gh = await question(`  Enter GitHub Token (press Enter to skip/keep current): `);

  rl.close();

  const envPath = path.join(targetDir, '.env');
  let envLines = [];
  if (fs.existsSync(envPath)) {
    envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  }

  const updates = {};
  if (ak.trim()) updates[`${envPrefix}_API_KEY`] = ak.trim();
  if (hk.trim()) updates[`${envPrefix}_MODEL_HAIKU`] = hk.trim();
  if (sk.trim()) updates[`${envPrefix}_MODEL_SONNET`] = sk.trim();
  if (gh.trim()) updates[`GITHUB_TOKEN`] = gh.trim();

  if (Object.keys(updates).length === 0) {
    console.log('\n  No changes made.');
    return;
  }

  for (const [key, val] of Object.entries(updates)) {
    let found = false;
    for (let i = 0; i < envLines.length; i++) {
      if (envLines[i].startsWith(`${key}=`)) {
        envLines[i] = `${key}="${val}"`;
        found = true;
        break;
      }
    }
    if (!found) envLines.push(`${key}="${val}"`);
  }

  fs.writeFileSync(envPath, envLines.join('\n') + '\n');

  console.log('');
  log('green', `  ✓ Configuration saved to .env`);
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
  'git-os': { label: 'GIT-OS', desc: 'Conventional commits, atomic changes, pre-push checklist', recommended: true },
  'pr-create': { label: 'PR Create', desc: 'Agent-driven PR creation with GIT-OS validation', recommended: true },
  'pr-review': { label: 'PR Review', desc: 'Gemini review fix queue — categorized by impact, fixed on approval', recommended: true },
  'greenfield': { label: 'Greenfield Planner', desc: 'Multi-agent project planning → PLAN.md', recommended: false },
  'sprint': { label: 'Sprint', desc: 'Branch name, PR title, PR description from ticket', recommended: false },
  'deploy-checklist': { label: 'Deploy Checklist', desc: 'Pre/post deploy verification checklist', recommended: false },
  'wednesday-dev': { label: 'Wednesday Dev', desc: 'Import ordering, complexity limits, naming conventions', recommended: true },
  'wednesday-design': { label: 'Wednesday Design', desc: '492+ approved UI components, design tokens, animations', recommended: false },
  // Brownfield bundles — shown as three items, expand to skill files + hooks at install time
  'brownfield': {
    label: 'Brownfield', desc: 'Dep graph, blast radius, risk scores, git hooks (zero LLM)', recommended: true,
    bundle: ['brownfield-chat', 'brownfield-fix']
  },
  'brownfield-ai': {
    label: 'Brownfield AI', desc: 'Summaries, MASTER.md, gap filling via Haiku (optional: OPENROUTER_API_KEY or ANTHROPIC_API_KEY)', recommended: false,
    requires: 'brownfield', bundle: ['brownfield-chat', 'brownfield-fix']
  },
  'brownfield-chat': {
    label: 'Brownfield Chat', desc: 'Plain-English Q&A from graph — who/what/which/when, path traversal, git diff', recommended: false,
    requires: 'brownfield', bundle: ['brownfield-chat']
  },
  'brownfield-drift': {
    label: 'Brownfield Drift', desc: 'Architecture drift detection against PLAN.md boundaries — zero LLM, CI-ready', recommended: false,
    requires: 'brownfield', bundle: ['brownfield-drift']
  },
  'brownfield-enrich': {
    label: 'Brownfield Enrich', desc: 'Agent-driven comment enrichment — no API key needed, uses the running agent', recommended: false,
    requires: 'brownfield', bundle: ['brownfield-enrich']
  },
};

// PR scripts that can be auto-triggered on `ws-skills pr`
const PR_SCRIPTS = [
  { id: 'coverage', label: 'Coverage', desc: 'Run test coverage after PR creation and post report', recommended: true },
  { id: 'sonar', label: 'SonarQube', desc: 'Run SonarQube analysis after PR creation and post report', recommended: false },
];

// AI agents that can be configured with skill instructions
const AGENT_OPTIONS = [
  { id: 'claude', label: 'Claude Code', file: 'CLAUDE.md', recommended: true },
  { id: 'gemini', label: 'Gemini CLI', file: 'GEMINI.md', recommended: false },
  { id: 'cursor', label: 'Cursor', file: '.cursorrules', recommended: false },
  { id: 'copilot', label: 'GitHub Copilot', file: '.github/copilot-instructions.md', recommended: false },
];

// Individual brownfield skills hidden from checklist — exposed as bundles
const BROWNFIELD_INDIVIDUAL = new Set(['brownfield-fix', 'brownfield-chat', 'brownfield-drift', 'brownfield-enrich']);

/**
 * Build the display list for the checklist:
 * - hides individual brownfield-* skills
 * - appends the two brownfield bundle items at the end
 */
function buildChecklistItems(rawSkills) {
  const individual = rawSkills.filter(s => !BROWNFIELD_INDIVIDUAL.has(s));
  // Add bundles as virtual entries at the end
  const bundles = ['brownfield', 'brownfield-ai', 'brownfield-chat', 'brownfield-drift', 'brownfield-enrich'];
  return [...individual, ...bundles];
}

/**
 * Expand selected checklist items into actual skill folder names to install.
 * brownfield / brownfield-ai → ['brownfield-chat','brownfield-fix']
 */
function expandSkills(selectedItems) {
  const expanded = new Set();
  for (const item of selectedItems) {
    const meta = SKILL_META[item];
    if (meta?.bundle) {
      meta.bundle.forEach(s => expanded.add(s));
    } else {
      expanded.add(item);
    }
  }
  return [...expanded];
}

function promptChecklist(rawSkills) {
  const checklistItems = buildChecklistItems(rawSkills);
  const readline = require('readline');

  // ── Prompt 1: Skills + PR Scripts ──────────────────────────────────────────
  console.log('');
  log('cyan', '  Select skills and scripts to install:');
  console.log('  (Enter numbers separated by commas, or "all" for everything)\n');

  console.log(`  ${colors.yellow}── Skills ──${colors.reset}`);
  checklistItems.forEach((skill, i) => {
    const meta = SKILL_META[skill] || { label: skill, desc: '', recommended: false };
    const tag = meta.recommended ? `${colors.green} [recommended]${colors.reset}` : '';
    const req = meta.requires ? `${colors.yellow} [requires Brownfield]${colors.reset}` : '';
    const num = `${colors.cyan}${String(i + 1).padStart(2)}${colors.reset}`;
    console.log(`  ${num}. ${meta.label.padEnd(22)}${meta.desc}${tag}${req}`);
  });

  console.log('');
  console.log(`  ${colors.yellow}── PR Scripts (auto-run on ws-skills pr) ──${colors.reset}`);
  const scriptOffset = checklistItems.length;
  PR_SCRIPTS.forEach((script, i) => {
    const tag = script.recommended ? `${colors.green} [recommended]${colors.reset}` : '';
    const num = `${colors.cyan}${String(scriptOffset + i + 1).padStart(2)}${colors.reset}`;
    console.log(`  ${num}. ${script.label.padEnd(22)}${script.desc}${tag}`);
  });

  console.log('');

  const totalSkillItems = checklistItems.length + PR_SCRIPTS.length;

  return new Promise(resolve => {
    const rl1 = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl1.question('  Your selection: ', answer1 => {
      rl1.close();
      const input1 = answer1.trim().toLowerCase();

      let selectedItems, selectedScripts;

      if (!input1 || input1 === 'all') {
        selectedItems = [...checklistItems];
        selectedScripts = PR_SCRIPTS.map(s => s.id);
      } else {
        const indices = input1.split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= totalSkillItems);
        selectedItems = [...new Set(indices.filter(n => n <= checklistItems.length))].map(n => checklistItems[n - 1]);
        selectedScripts = [...new Set(
          indices.filter(n => n > checklistItems.length)
        )].map(n => PR_SCRIPTS[n - checklistItems.length - 1].id);
      }

      // If brownfield-ai selected without brownfield, auto-add brownfield
      if (selectedItems.includes('brownfield-ai') && !selectedItems.includes('brownfield')) {
        selectedItems.unshift('brownfield');
      }

      // ── Prompt 2: AI Agents ───────────────────────────────────────────────
      console.log('');
      log('cyan', '  Which AI agents should be configured with your skills?');
      console.log('  (Enter numbers separated by commas, or "all", or press Enter to skip)\n');

      AGENT_OPTIONS.forEach((agent, i) => {
        const tag = agent.recommended ? `${colors.green} [recommended]${colors.reset}` : '';
        const num = `${colors.cyan}${String(i + 1).padStart(2)}${colors.reset}`;
        console.log(`  ${num}. ${agent.label.padEnd(22)}→ ${agent.file}${tag}`);
      });

      console.log('');

      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl2.question('  Your selection: ', answer2 => {
        rl2.close();
        const input2 = answer2.trim().toLowerCase();

        let selectedAgents;
        if (input2 === 'all') {
          selectedAgents = AGENT_OPTIONS.map(a => a.id);
        } else if (!input2) {
          selectedAgents = [];
        } else {
          const agentIndices = input2.split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= AGENT_OPTIONS.length);
          selectedAgents = [...new Set(agentIndices)].map(n => AGENT_OPTIONS[n - 1].id);
        }

        resolve({
          skills: expandSkills(selectedItems),
          scripts: selectedScripts,
          selectedBundles: selectedItems,
          selectedAgents,
        });
      });
    });
  });
}

// ─── Conflict detection ───────────────────────────────────────────────────────

const SKILL_CONFLICTS = [
  { skill: 'brownfield-chat', requires: ['.wednesday/graph.db'], reason: 'run wednesday-skills analyze first' },
  { skill: 'brownfield-drift', requires: ['.wednesday/plans/PLAN.md'], reason: 'create PLAN.md first (run wednesday-skills plan)' },
];

function checkConflicts(targetDir, installedSkills) {
  const warnings = [];
  const skillSet = new Set(installedSkills);

  for (const rule of SKILL_CONFLICTS) {
    if (!skillSet.has(rule.skill)) continue;

    if (rule.conflicts) {
      for (const c of rule.conflicts) {
        if (skillSet.has(c)) {
          warnings.push(`Conflict: "${rule.skill}" and "${c}" are both installed. ${rule.reason}`);
        }
      }
    }
    if (rule.requires) {
      for (const req of rule.requires) {
        if (!fs.existsSync(path.join(targetDir, req))) {
          warnings.push(`Missing dependency for "${rule.skill}": ${req}. ${rule.reason}`);
        }
      }
    }
  }
  return warnings;
}

// ─── Registry commands ────────────────────────────────────────────────────────

function loadRegistry() {
  // Try local cache first, fall back to bundled registry
  const cachePath = path.join(require('os').homedir(), '.wednesday', 'registry-cache.json');
  const bundledPath = path.join(__dirname, '..', 'registry', 'index.json');
  if (fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (_) { }
  }
  if (fs.existsSync(bundledPath)) {
    return JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
  }
  return { version: '1.0', skills: [] };
}

function runRegistrySearch(query, tag) {
  const registry = loadRegistry();
  let results = registry.skills;
  if (tag) results = results.filter(s => s.tags && s.tags.includes(tag));
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.tags && s.tags.some(t => t.includes(q)))
    );
  }
  if (!results.length) { log('yellow', 'No skills found.'); return; }
  console.log('');
  results.forEach(s => {
    const tags = s.tags ? `  [${s.tags.join(', ')}]` : '';
    console.log(`  ${colors.cyan}${s.name.padEnd(30)}${colors.reset}${s.description}${colors.yellow}${tags}${colors.reset}`);
  });
  console.log('');
}

function runRegistryAdd(skillSpec, targetDir) {
  const [name] = skillSpec.split('@');
  const registry = loadRegistry();
  const entry = registry.skills.find(s => s.name === name);
  if (!entry) {
    log('red', `Skill "${name}" not found in registry. Run wednesday-skills search to browse.`);
    process.exit(1);
  }
  const skillsDir = path.join(targetDir, '.wednesday', 'skills');
  const dest = path.join(skillsDir, name);
  if (fs.existsSync(dest)) {
    log('yellow', `"${name}" is already installed. Run wednesday-skills update ${name} to upgrade.`);
    return;
  }
  // Pull from bundled skills
  const src = path.join(__dirname, '..', 'skills', name);
  if (!fs.existsSync(src)) {
    log('red', `Skill "${name}" files not found in package. Try reinstalling the package.`);
    process.exit(1);
  }
  fs.mkdirSync(skillsDir, { recursive: true });
  copyRecursive(src, dest);
  log('green', `✓ ${name} installed`);
  configure(targetDir, 'all');
  const warnings = checkConflicts(targetDir, fs.readdirSync(skillsDir));
  warnings.forEach(w => log('yellow', `Warning: ${w}`));
}

function runRegistryRemove(skillName, targetDir) {
  const dest = path.join(targetDir, '.wednesday', 'skills', skillName);
  if (!fs.existsSync(dest)) {
    log('yellow', `"${skillName}" is not installed.`);
    return;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  log('green', `✓ ${skillName} removed`);
  configure(targetDir, 'all');
}

function runRegistryUpdate(skillName, targetDir) {
  const skillsDir = path.join(targetDir, '.wednesday', 'skills');
  const toUpdate = skillName
    ? [skillName]
    : (fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : []);

  toUpdate.forEach(name => {
    const src = path.join(__dirname, '..', 'skills', name);
    const dest = path.join(skillsDir, name);
    if (!fs.existsSync(src) || !fs.existsSync(dest)) return;
    fs.rmSync(dest, { recursive: true, force: true });
    copyRecursive(src, dest);
    log('green', `✓ ${name} updated`);
  });
  configure(targetDir, 'all');
}

function runRegistryCheck(targetDir) {
  const skillsDir = path.join(targetDir, '.wednesday', 'skills');
  if (!fs.existsSync(skillsDir)) {
    log('yellow', 'No skills installed. Run wednesday-skills install first.');
    return;
  }
  const installed = fs.readdirSync(skillsDir);
  console.log('');
  log('cyan', `Installed skills (${installed.length}):`);
  installed.forEach(s => log('green', `  ✓ ${s}`));
  console.log('');
  const warnings = checkConflicts(targetDir, installed);
  if (warnings.length) {
    log('yellow', 'Warnings:');
    warnings.forEach(w => log('yellow', `  ⚠ ${w}`));
  } else {
    log('green', 'No conflicts detected.');
  }
  console.log('');
}

function runBuildSkill(targetDir) {
  requireLib('builder').interactive(targetDir);
}

function runSubmitSkill(skillName, targetDir) {
  requireLib('builder').submit(skillName, targetDir);
}

function runStats(targetDir, opts = {}) {
  requireLib('analytics').stats(targetDir, opts);
}

function requireLib(name) {
  const libPath = path.join(__dirname, '..', 'lib', `${name}.js`);
  if (!fs.existsSync(libPath)) {
    log('red', `lib/${name}.js not found. Reinstall the package.`);
    process.exit(1);
  }
  return require(libPath);
}

function saveWednesdayConfig(targetDir, scripts) {
  const configPath = path.join(targetDir, '.wednesday', 'config.json');
  let existing = {};
  if (fs.existsSync(configPath)) {
    try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { }
  }
  existing.pr_scripts = {
    coverage: scripts.includes('coverage'),
    sonar: scripts.includes('sonar'),
  };
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  log('green', '  ✓ .wednesday/config.json saved');
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
  const doInstall = async ({ skills: selectedSkills, scripts: selectedScripts = [], selectedBundles = [], selectedAgents = [] }) => {
    // Create .wednesday/skills directory
    const skillsDir = path.join(targetDir, '.wednesday', 'skills');
    log('blue', `\nCreating skills directory: ${skillsDir}`);
    fs.mkdirSync(skillsDir, { recursive: true });

    selectedSkills.forEach(skill => {
      const src = path.join(skillsSource, skill);
      const dest = path.join(skillsDir, skill);
      const isUpdate = fs.existsSync(dest);
      // Wipe first so removed files from older versions don't linger
      if (isUpdate) fs.rmSync(dest, { recursive: true, force: true });
      log('blue', `${isUpdate ? 'Updating' : 'Installing'} ${skill} skill...`);
      copyRecursive(src, dest);
      log('green', `  ✓ ${skill} ${isUpdate ? 'updated' : 'installed'}`);
    });

    // Symlink .wednesday/skills/* into .claude/skills/ so Claude Code's
    // skill picker discovers them without duplicating files.
    const claudeSkillsDir = path.join(targetDir, '.claude', 'skills');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });
    selectedSkills.forEach(skill => {
      const linkPath = path.join(claudeSkillsDir, skill);
      const linkTarget = path.join('..', '..', '.wednesday', 'skills', skill);
      try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch (_) { }
      fs.symlinkSync(linkTarget, linkPath);
      log('green', `  ✓ ${skill} linked to .claude/skills/`);
    });

    // Copy GitHub Action workflows and scripts based on selection
    copyGitHubAssets(packageRoot, targetDir, selectedScripts);

    // Copy commitlint config
    const commitlintSrc = path.join(packageRoot, '.commitlintrc.json');
    const commitlintDest = path.join(targetDir, '.commitlintrc.json');
    if (fs.existsSync(commitlintSrc) && !fs.existsSync(commitlintDest)) {
      fs.copyFileSync(commitlintSrc, commitlintDest);
      log('green', '  ✓ .commitlintrc.json copied');
    }

    // Save PR script preferences to .wednesday/config.json
    saveWednesdayConfig(targetDir, selectedScripts);

    // Write default tools.json
    ensureToolsConfig(targetDir);

    // Install git hooks for brownfield intelligence (if brownfield selected)
    const hasBrownfield = selectedBundles.includes('brownfield') || selectedBundles.includes('brownfield-ai')
      || selectedSkills.some(s => s.startsWith('brownfield'));
    const hasBrownfieldAI = selectedBundles.includes('brownfield-ai');

    if (hasBrownfield || selectedSkills.includes('git-os')) {
      const hooksInstalled = brownfield.installHooks(targetDir);
      if (hooksInstalled) {
        log('green', '  ✓ Git hooks installed (post-commit, post-merge)');
      }
    }

    // Write .claude/settings.json hook — LLM steps only if brownfield-ai selected
    if (hasBrownfield) {
      installClaudeHook(targetDir, hasBrownfieldAI);
    }

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

    // Configure selected agents only
    if (!skipConfig && selectedSkills.length > 0 && selectedAgents.length > 0) {
      console.log('');
      log('blue', 'Configuring AI agents to discover skills...');
      console.log('');
      for (const agent of selectedAgents) {
        configure(targetDir, agent);
      }
    }

    // Final summary
    console.log('');
    if (selectedSkills.length > 0) {
      log('blue', `Skills location: ${skillsDir}`);
      if (selectedAgents.length > 0) {
        console.log('');
        log('cyan', 'Configured agents:');
        for (const agentId of selectedAgents) {
          const agent = AGENT_OPTIONS.find(a => a.id === agentId);
          if (agent) console.log(`  • ${agent.label.padEnd(16)} → ${agent.file}`);
        }
      }
      console.log('');
    }
    if (selectedScripts.length > 0) {
      log('blue', `PR scripts: .wednesday/scripts/`);
      log('cyan', 'Auto-run after ws-skills pr:');
      selectedScripts.forEach(s => console.log(`  • ${s}`));
      console.log('');
    }
  };

  if (skipChecklist) {
    const allItems = buildChecklistItems(availableSkills);
    doInstall({
      skills: expandSkills(allItems),
      scripts: PR_SCRIPTS.map(s => s.id),
      selectedBundles: allItems,
      selectedAgents: AGENT_OPTIONS.map(a => a.id),
    }).catch(e => { console.error(e.message); process.exit(1); });
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

function copyGitHubAssets(packageRoot, targetDir, selectedScripts = []) {
  const assetsDir = path.join(packageRoot, 'assets', 'workflows');
  if (!fs.existsSync(assetsDir)) return;

  const githubWorkflowsDir = path.join(targetDir, '.github', 'workflows');
  fs.mkdirSync(githubWorkflowsDir, { recursive: true });

  // Core workflows always installed; script workflows only if selected
  const scriptWorkflows = { coverage: 'pr-coverage.yml', sonar: 'pr-sonar.yml' };
  const skipWorkflows = new Set(
    Object.entries(scriptWorkflows)
      .filter(([id]) => !selectedScripts.includes(id))
      .map(([, file]) => file)
  );

  const files = fs.readdirSync(assetsDir);
  files.forEach(file => {
    if (skipWorkflows.has(file)) return;
    const src = path.join(assetsDir, file);
    const dest = path.join(githubWorkflowsDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      log('green', `  ✓ .github/workflows/${file} copied`);
    }
  });

  // Copy selected PR scripts to .wednesday/scripts/ so CI workflows can find them
  const scriptsSource = path.join(packageRoot, 'assets', 'scripts');
  if (selectedScripts.length && fs.existsSync(scriptsSource)) {
    const wednesdayScriptsDir = path.join(targetDir, '.wednesday', 'scripts');
    fs.mkdirSync(wednesdayScriptsDir, { recursive: true });

    selectedScripts.forEach(id => {
      const file = `pr-${id}.sh`;
      const src = path.join(scriptsSource, file);
      const dest = path.join(wednesdayScriptsDir, file);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
        log('green', `  ✓ .wednesday/scripts/${file} copied`);
      }
    });
  }
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
  console.log('  coverage [base] [--post]     Run test coverage report and post to PR');
  console.log('  sonar [base] [--post]        Run SonarQube report and post to PR');
  console.log('');
  console.log('Brownfield Intelligence (Phase 2):');
  console.log('  map [dir]                    Full pipeline: parse → summarize → fill gaps');
  console.log('  analyze [dir]                Build/update dependency graph');
  console.log('  analyze --incremental        Only re-parse changed files (< 1s)');
  console.log('  analyze --full               Force full re-parse');
  console.log('  analyze --watch              Watch mode for development');
  console.log('  summarize [dir]              Generate summaries.json + MASTER.md');
  console.log('  fill-gaps [--file <f>]       Run subagents on coverage gaps');
  console.log('  blast <file>                 Show blast radius (BFS reverse traversal)');
  console.log('  score <file>                 Show risk score (0–100)');
  console.log('  dead                         List dead files and unused exports');
  console.log('  legacy                       Legacy health: god files, circular deps, debt');
  console.log('  api-surface [file]           Show public contracts vs internal exports');
  console.log('  trace <file> [fn]            Trace call chain from file/function');
  console.log('  plan-refactor "goal"         AI refactor plan (Sonnet, ~$0.12)');
  console.log('  plan-migration "goal"        AI migration strategy (Sonnet, ~$0.15)');
  console.log('  onboard                      Interactive onboarding guide (Haiku)');
  console.log('');
  console.log('Brownfield Intelligence (Phase 3):');
  console.log('  chat "question"              Ask any question about the codebase in plain English');
  console.log('  drift                        Check architecture drift against PLAN.md constraints');
  console.log('  drift --rule <name>          Check a single boundary rule');
  console.log('  drift --since <commit>       Only report new violations (for PR review)');
  console.log('  drift --fix                  Show suggested fix for each violation');
  console.log('  gen-tests                    Generate tests for high-risk uncovered files (Sonnet)');
  console.log('  gen-tests --dry-run          Show targets without generating');
  console.log('  gen-tests --file <f>         Generate tests for a specific file');
  console.log('  gen-tests --min-risk <n>     Only target files with risk above n (default: 50)');
  console.log('  list                         List installed skills');
  console.log('');
  console.log('Registry (Phase 4):');
  console.log('  search "<query>" [--tag <t>] Search the skill registry');
  console.log('  add <skill>[@version]        Install a skill from the registry');
  console.log('  remove <skill>               Uninstall a skill');
  console.log('  update [<skill>]             Update one or all installed skills');
  console.log('  check                        List installed skills and detect conflicts');
  console.log('  build-skill                  AI-generate a new SKILL.md interactively');
  console.log('  submit <skill>               Submit a skill to the public registry via PR');
  console.log('  stats [--cost] [--stale]     Show skill usage analytics');
  console.log('');
  console.log('IDE-handled (ask Claude instead):');
  console.log('  blast, score, chat, gen-tests, plan-refactor, onboard');
  console.log('  → These redirect to the equivalent Claude prompt.');
  console.log('');
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
  console.log('  wednesday-skills coverage develop --post');
  console.log('  wednesday-skills sonar develop --dry-run');
  console.log('');
  console.log('Agent Configuration Files:');
  console.log('  Claude Code    → CLAUDE.md');
  console.log('  Gemini CLI     → GEMINI.md');
  console.log('  Antigravity    → ~/.gemini/antigravity/skills/ (file-copy via sync)');
  console.log('  Cursor         → .cursorrules');
  console.log('  GitHub Copilot → .github/copilot-instructions.md');
  console.log('');
}

// ─── Phase 3 brownfield commands ─────────────────────────────────────────────

function runChat(question, targetDir) {
  targetDir = path.resolve(targetDir);
  console.log('');
  log('cyan', `Querying: "${question}"`);
  console.log('');

  brownfield.chat(question, targetDir).then(result => {
    console.log(result.answer);
    console.log('');
    log('blue', `Source: ${result.source}`);
    if (result.type) log('blue', `Method: ${result.type}`);
    console.log('');
  }).catch(e => {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  });
}

function runDrift(targetDir, opts) {
  targetDir = path.resolve(targetDir);
  console.log('');
  log('blue', '┌─────────────────────────────────────────────┐');
  log('blue', '│  Architecture drift check                   │');
  log('blue', '└─────────────────────────────────────────────┘');
  console.log('');

  let result;
  try {
    result = brownfield.drift(targetDir, opts);
  } catch (e) {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  }

  if (result.noConstraints) {
    log('yellow', '  No machine-readable constraints found in PLAN.md.');
    log('yellow', '  Add a "boundaries" JSON block to PLAN.md to enable drift detection.');
    log('cyan', '  See: wednesday-skills help');
    console.log('');
    return;
  }

  // Filter by rule if --rule provided
  let violations = result.violations;
  if (opts.rule) {
    violations = violations.filter(v => v.rule === opts.rule);
  }

  if (violations.length === 0) {
    log('green', opts.since
      ? `  No new drift since ${opts.since}.`
      : '  No architecture drift detected.');
    console.log('');
    return;
  }

  log('red', `  VIOLATIONS (${violations.length}):`);
  console.log('');

  for (const v of violations) {
    const severityColor = v.severity === 'high' ? 'red' : 'yellow';
    log(severityColor, `  ${v.severity.toUpperCase()} — ${v.rule}`);
    console.log(`    ${v.description}`);
    console.log(`    Edge: ${v.edge}`);
    if (v.introducedBy) {
      console.log(`    Introduced: commit ${v.introducedBy.hash} on ${v.introducedBy.date} by ${v.introducedBy.author}`);
      console.log(`    Subject: ${v.introducedBy.subject}`);
    }
    if (opts.fix) {
      log('cyan', `    Fix: ${v.fix}`);
    }
    console.log('');
  }

  process.exit(1); // Non-zero exit for CI/CD integration
}

function runGenTests(targetDir, opts) {
  targetDir = path.resolve(targetDir);
  console.log('');

  if (opts.dryRun) {
    log('blue', '┌─────────────────────────────────────────────┐');
    log('blue', '│  Test generation targets (dry run)          │');
    log('blue', '└─────────────────────────────────────────────┘');
    console.log('');

    let targets;
    try {
      targets = brownfield.genTestsTargets(targetDir, opts);
    } catch (e) {
      log('red', `Error: ${e.message}`);
      process.exit(1);
    }

    if (targets.length === 0) {
      log('green', '  No files match the criteria (risk > ' + opts.minRisk + ', coverage < 30%).');
      console.log('');
      return;
    }

    log('cyan', `  Files targeted for test generation (ranked by priority):`);
    console.log('');
    targets.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.file.padEnd(50)} risk:${t.node.riskScore}  coverage:${t.coverage}%  priority:${t.priority}`);
    });
    console.log('');
    log('yellow', `  Run without --dry-run to generate ${targets.length} test file(s). Requires OPENROUTER_API_KEY or ANTHROPIC_API_KEY.`);
    console.log('');
    return;
  }

  log('blue', '┌─────────────────────────────────────────────┐');
  log('blue', '│  Generating tests (Sonnet)                  │');
  log('blue', '└─────────────────────────────────────────────┘');
  console.log('');

  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    log('red', '  No API key set. Test generation requires OPENROUTER_API_KEY or ANTHROPIC_API_KEY.');
    log('yellow', '  Run with --dry-run to see which files would be targeted.');
    process.exit(1);
  }

  brownfield.genTests(targetDir, opts).then(results => {
    console.log('');
    const succeeded = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);
    log('green', `  ✓ Generated: ${succeeded.length} test file(s)`);
    if (failed.length > 0) log('yellow', `  ⚠ Failed: ${failed.length}`);
    console.log('');
    succeeded.forEach(r => console.log(`    ${r.testPath}  (risk:${r.risk}, coverage:${r.coverage}%)`));
    console.log('');
  }).catch(e => {
    log('red', `Error: ${e.message}`);
    process.exit(1);
  });
}

function listSkills() {
  log('blue', 'Available skills:');
  console.log('');
  console.log('  git-os');
  console.log('    Conventional commits, atomic changes, GIT-OS workflow.');
  console.log('    Read before generating any commit message.');
  console.log('');
  console.log('  pr-review');
  console.log('    Gemini review fix queue — categorized by impact, fixed on dev approval.');
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
  console.log('  brownfield');
  console.log('    Dep graph, blast radius, risk scores, git hooks. Zero LLM.');
  console.log('    Includes: brownfield-chat, brownfield-fix skills.');
  console.log('');
  console.log('  brownfield-ai  [requires brownfield]');
  console.log('    Summaries, MASTER.md, gap filling via Haiku subagents.');
  console.log('    Needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY. Runs in background, never blocks.');
  console.log('');
  console.log('  brownfield-chat  [requires brownfield]');
  console.log('    Plain-English Q&A backed by the graph — zero LLM for most queries.');
  console.log('    Handles: who wrote, what does X do, what breaks if, which files match,');
  console.log('             path from X to Y, what changed. Haiku fallback for synthesis (~$0.005).');
  console.log('    Usage: wednesday-skills chat "your question"');
  console.log('');
  console.log('  brownfield-drift  [requires brownfield]');
  console.log('    Architecture drift detection. Compares dep-graph.json against');
  console.log('    machine-readable boundaries in PLAN.md. Zero LLM. CI-ready (exit 1 on violation).');
  console.log('    Usage: wednesday-skills drift [--rule <name>] [--since <commit>] [--fix]');
  console.log('');
}

main();
