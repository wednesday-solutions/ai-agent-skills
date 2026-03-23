'use strict';

/**
 * Agentic Skill Composition Engine
 *
 * Plain async JavaScript — no LangChain or orchestration library.
 * Sequential = for loop. Parallel = Promise.all.
 *
 * agent.yml format:
 *   name: my-agent
 *   stages:
 *     - type: sequential
 *       steps: [skill-a, skill-b]
 *     - type: parallel
 *       steps: [skill-c, skill-d]
 */

const fs   = require('fs');
const path = require('path');

/**
 * Run steps one after another. Each step receives the accumulated context
 * from all previous steps merged in.
 */
async function runSequential(steps, context, runner) {
  let ctx = { ...context };
  for (const step of steps) {
    const result = await runner(step, ctx);
    ctx = { ...ctx, ...result };
  }
  return ctx;
}

/**
 * Run all steps simultaneously with the same input context.
 * Results are merged (later keys win on collision).
 */
async function runParallel(steps, context, runner) {
  const results = await Promise.all(steps.map(step => runner(step, context)));
  return Object.assign({}, context, ...results);
}

/**
 * Execute a full agent workflow from a parsed agent.yml definition.
 *
 * @param {object} agentDef  - Parsed agent.yml object
 * @param {object} context   - Initial context passed to the first stage
 * @param {Function} runner  - async (stepName, ctx) => resultObject
 */
async function runWorkflow(agentDef, context, runner) {
  let ctx = { ...context };
  for (const stage of agentDef.stages) {
    const fn = stage.type === 'parallel' ? runParallel : runSequential;
    ctx = { ...ctx, ...await fn(stage.steps, ctx, runner) };
  }
  return ctx;
}

/**
 * Load and parse an agent.yml file for a given agent name.
 * Looks in .wednesday/skills/agents/<name>/agent.yml first,
 * then falls back to the package's skills/agents/<name>/agent.yml.
 */
function loadAgentDef(agentName, targetDir) {
  const locations = [
    path.join(targetDir, '.wednesday', 'skills', 'agents', agentName, 'agent.yml'),
    path.join(__dirname, '..', 'skills', 'agents', agentName, 'agent.yml'),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return parseAgentYml(fs.readFileSync(loc, 'utf8'));
    }
  }
  throw new Error(`Agent definition not found for "${agentName}". Looked in:\n  ${locations.join('\n  ')}`);
}

/**
 * Minimal YAML parser for agent.yml files.
 * Supports the subset used by agent definitions: name, stages, type, steps.
 */
function parseAgentYml(content) {
  const lines = content.split('\n');
  const result = { stages: [] };
  let currentStage = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) { result.name = nameMatch[1].trim(); continue; }

    const stageTypeMatch = line.match(/^\s{2}-\s+type:\s*(.+)/);
    if (stageTypeMatch) {
      currentStage = { type: stageTypeMatch[1].trim(), steps: [] };
      result.stages.push(currentStage);
      continue;
    }

    const stepsInlineMatch = line.match(/^\s{4}steps:\s*\[(.+)\]/);
    if (stepsInlineMatch && currentStage) {
      currentStage.steps = stepsInlineMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
      continue;
    }

    const stepItemMatch = line.match(/^\s{4}-\s*(.+)/);
    if (stepItemMatch && currentStage) {
      currentStage.steps.push(stepItemMatch[1].trim());
    }
  }
  return result;
}

module.exports = { runSequential, runParallel, runWorkflow, loadAgentDef, parseAgentYml };
