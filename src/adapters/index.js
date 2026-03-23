'use strict';

/**
 * Tool adapter registry.
 *
 * Each adapter knows how to inject skill references into a specific AI tool's
 * config file (XML block) or skills directory (file-copy).
 *
 * tools.json schema:
 * {
 *   "tools": [
 *     { "name": "claude-code",  "config": "CLAUDE.md",                          "format": "xml-block" },
 *     { "name": "gemini-cli",   "config": "GEMINI.md",                          "format": "xml-block" },
 *     { "name": "antigravity",  "config": "~/.gemini/antigravity/skills/",       "format": "file-copy" }
 *   ]
 * }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeCodeAdapter = require('./claude-code');
const antigravityAdapter = require('./antigravity');
const geminiCliAdapter = require('./gemini-cli');

const ADAPTERS = {
  'claude-code': claudeCodeAdapter,
  'antigravity': antigravityAdapter,
  'gemini-cli': geminiCliAdapter,
};

/**
 * Default tools.json written to new projects on install.
 */
const DEFAULT_TOOLS_CONFIG = {
  tools: [
    { name: 'claude-code', config: 'CLAUDE.md', format: 'xml-block' },
    { name: 'gemini-cli', config: 'GEMINI.md', format: 'xml-block' },
    {
      name: 'antigravity',
      config: path.join(os.homedir(), '.gemini', 'antigravity', 'skills'),
      format: 'file-copy',
    },
  ],
};

/**
 * Load tools.json from project, falling back to defaults.
 */
function loadToolsConfig(projectDir) {
  const configPath = path.join(projectDir, '.wednesday', 'tools.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn('Warning: .wednesday/tools.json is invalid JSON, using defaults.');
    }
  }
  return DEFAULT_TOOLS_CONFIG;
}

/**
 * Write default tools.json if it doesn't exist yet.
 */
function ensureToolsConfig(projectDir) {
  const wednesdayDir = path.join(projectDir, '.wednesday');
  const configPath = path.join(wednesdayDir, 'tools.json');
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(wednesdayDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_TOOLS_CONFIG, null, 2));
  }
}

/**
 * Run all adapters (or a specific tool) for the given project.
 * @param {string} projectDir
 * @param {string|null} toolFilter — name of specific tool to sync, or null for all
 */
function syncAdapters(projectDir, toolFilter = null) {
  const config = loadToolsConfig(projectDir);
  const skillsDir = path.join(projectDir, '.wednesday', 'skills');

  if (!fs.existsSync(skillsDir)) {
    console.error('Skills not installed. Run "wednesday-skills install" first.');
    return;
  }

  const tools = toolFilter
    ? config.tools.filter(t => t.name === toolFilter)
    : config.tools;

  if (toolFilter && tools.length === 0) {
    console.error(`Unknown tool: ${toolFilter}`);
    console.error(`Available tools: ${config.tools.map(t => t.name).join(', ')}`);
    return;
  }

  for (const tool of tools) {
    const adapter = ADAPTERS[tool.name];
    if (!adapter) {
      console.warn(`No adapter found for tool: ${tool.name} — skipping`);
      continue;
    }

    try {
      adapter.sync(projectDir, skillsDir, tool);
      console.log(`  ✓ ${tool.name} synced`);
    } catch (err) {
      console.error(`  ✗ ${tool.name} failed: ${err.message}`);
    }
  }
}

module.exports = { syncAdapters, ensureToolsConfig, loadToolsConfig, DEFAULT_TOOLS_CONFIG };
