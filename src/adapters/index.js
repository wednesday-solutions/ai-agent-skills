'use strict';

/**
 * @wednesday-skills:purpose Tool adapter registry — routes sync and install commands to per-agent adapters.
 * @wednesday-skills:risk low
 *
 * tools.json schema:
 * {
 *   "tools": [
 *     { "name": "claude-code",  "config": "CLAUDE.md",                              "format": "xml-block"  },
 *     { "name": "gemini-cli",   "config": "GEMINI.md",                              "format": "xml-block"  },
 *     { "name": "cursor",       "config": ".cursorrules",                           "format": "xml-block"  },
 *     { "name": "copilot",      "config": ".github/copilot-instructions.md",        "format": "xml-block"  },
 *     { "name": "antigravity",  "config": "~/.gemini/antigravity/skills/",          "format": "file-copy"  }
 *   ]
 * }
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const claudeCodeAdapter  = require('./claude-code');
const antigravityAdapter = require('./antigravity');
const geminiCliAdapter   = require('./gemini-cli');
const cursorAdapter      = require('./cursor');
const copilotAdapter     = require('./copilot');

const ADAPTERS = {
  'claude-code': claudeCodeAdapter,
  'antigravity': antigravityAdapter,
  'gemini-cli':  geminiCliAdapter,
  'cursor':      cursorAdapter,
  'copilot':     copilotAdapter,
};

// Maps the short agent names used by `configure` / install to adapter names in tools.json
const AGENT_TO_ADAPTER = {
  claude:     'claude-code',
  gemini:     'gemini-cli',
  cursor:     'cursor',
  copilot:    'copilot',
  antigravity:'antigravity',
};

// Default tool entries — written on first install, extended by configure()
const TOOL_DEFAULTS = {
  'claude-code':  { name: 'claude-code', config: 'CLAUDE.md',                          format: 'xml-block'  },
  'gemini-cli':   { name: 'gemini-cli',  config: 'GEMINI.md',                          format: 'xml-block'  },
  'cursor':       { name: 'cursor',      config: '.cursorrules',                        format: 'xml-block'  },
  'copilot':      { name: 'copilot',     config: '.github/copilot-instructions.md',     format: 'xml-block'  },
  'antigravity':  { name: 'antigravity', config: path.join(os.homedir(), '.gemini', 'antigravity', 'skills'), format: 'file-copy' },
};

function toolsConfigPath(projectDir) {
  return path.join(projectDir, '.wednesday', 'tools.json');
}

function loadToolsConfig(projectDir) {
  const configPath = toolsConfigPath(projectDir);
  if (fs.existsSync(configPath)) {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { console.warn('Warning: .wednesday/tools.json is invalid JSON, using defaults.'); }
  }
  return { tools: [] };
}

function saveToolsConfig(projectDir, config) {
  const configPath = toolsConfigPath(projectDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Write default tools.json if it doesn't exist yet.
 * Only claude-code + gemini-cli by default — cursor/copilot are opt-in via configure().
 */
function ensureToolsConfig(projectDir) {
  const configPath = toolsConfigPath(projectDir);
  if (!fs.existsSync(configPath)) {
    saveToolsConfig(projectDir, {
      tools: [
        TOOL_DEFAULTS['claude-code'],
        TOOL_DEFAULTS['gemini-cli'],
        TOOL_DEFAULTS['antigravity'],
      ],
    });
  }
}

/**
 * Register an agent in tools.json (called during install/configure).
 * Idempotent — updates existing entry if present.
 *
 * @param {string} projectDir
 * @param {string} agentName  — short name: 'claude' | 'gemini' | 'cursor' | 'copilot' | 'antigravity'
 */
function registerAgent(projectDir, agentName) {
  const adapterName = AGENT_TO_ADAPTER[agentName] || agentName;
  const def         = TOOL_DEFAULTS[adapterName];
  if (!def) return;

  const config = loadToolsConfig(projectDir);
  const exists  = config.tools.findIndex(t => t.name === adapterName);
  if (exists !== -1) {
    config.tools[exists] = def;
  } else {
    config.tools.push(def);
  }
  saveToolsConfig(projectDir, config);
}

/**
 * Run all adapters (or a specific tool) for the given project.
 *
 * @param {string}      projectDir
 * @param {string|null} toolFilter — adapter name or short agent name, or null for all
 */
function syncAdapters(projectDir, toolFilter = null) {
  const config    = loadToolsConfig(projectDir);
  const skillsDir = path.join(projectDir, '.wednesday', 'skills');

  if (!fs.existsSync(skillsDir)) {
    console.error('Skills not installed. Run "wednesday-skills install" first.');
    return;
  }

  // Normalise filter: short agent names → adapter names
  const normFilter = toolFilter ? (AGENT_TO_ADAPTER[toolFilter] || toolFilter) : null;

  const tools = normFilter
    ? config.tools.filter(t => t.name === normFilter)
    : config.tools;

  if (normFilter && tools.length === 0) {
    console.error(`Unknown tool: ${normFilter}`);
    console.error(`Available tools: ${config.tools.map(t => t.name).join(', ') || '(none registered — run install first)'}`);
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

module.exports = {
  syncAdapters,
  ensureToolsConfig,
  registerAgent,
  loadToolsConfig,
  ADAPTERS,
  AGENT_TO_ADAPTER,
  TOOL_DEFAULTS,
};
