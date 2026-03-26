# Project Guidelines

<!-- WEDNESDAY_SKILLS_START -->
## Wednesday Agent Skills

This project uses Wednesday Solutions agent skills for consistent code quality and design standards.

### Available Skills

<available_skills>
  <skill>
    <name>brownfield-chat</name>
    <description>Natural-language Q&A across the full codebase. Use for multi-module questions, "what breaks if", git history, cross-cutting queries, and anything spanning more than one file. For a single-file lookup use brownfield-query instead.</description>
    <location>.wednesday/skills/brownfield-chat/SKILL.md</location>
  </skill>
  <skill>
    <name>brownfield-drift</name>
    <description>Enforces architecture boundaries defined in PLAN.md. Use when a PR crosses module/service boundaries, when the dev asks "are we following the architecture?", or as a scheduled architecture health check. Not for querying what a module does — use brownfield-chat for that.</description>
    <location>.wednesday/skills/brownfield-drift/SKILL.md</location>
  </skill>
  <skill>
    <name>brownfield-enrich</name>
    <description>Schema reference for comment enrichment. The enrichment workflow is printed by `wednesday-skills map` in the `[ENRICH]` block — follow those instructions.</description>
    <location>.wednesday/skills/brownfield-enrich/SKILL.md</location>
  </skill>
  <skill>
    <name>brownfield-fix</name>
    <description>Use before editing any file in a brownfield project. Runs risk check and blast radius before making any change.</description>
    <location>.wednesday/skills/brownfield-fix/SKILL.md</location>
  </skill>
  <skill>
    <name>brownfield-gaps</name>
    <description>Improves graph coverage for a specific file with dynamic/unannotated patterns (event emitters, dynamic require, global injection). Use when dep-graph shows gaps on a file or when chat/query returns "not mapped". Not for querying — only for improving coverage.</description>
    <location>.wednesday/skills/brownfield-gaps/SKILL.md</location>
  </skill>
  <skill>
    <name>brownfield-query</name>
    <description>Deterministic lookups from dep-graph.json. Use for direct structural questions about a specific file or module — what it imports, what imports it, its risk score, its exports. For multi-module or natural-language questions use brownfield-chat instead.</description>
    <location>.wednesday/skills/brownfield-query/SKILL.md</location>
  </skill>
  <skill>
    <name>deploy-checklist</name>
    <description>Pre-deploy and post-deploy checklist skill. Ensures env vars, migrations, CI, rollback plan, smoke tests, and monitoring are verified before and after every deployment.</description>
    <location>.wednesday/skills/deploy-checklist/SKILL.md</location>
  </skill>
  <skill>
    <name>git-os</name>
    <description>Enforces conventional commits, atomic changes, and GIT-OS workflow for Wednesday Solutions projects. Every agent that generates a commit must read this skill first.</description>
    <location>.wednesday/skills/git-os/SKILL.md</location>
  </skill>
  <skill>
    <name>greenfield</name>
    <description>Parallel persona planning for new projects. Research agent runs first to build domain context, then Architect, PM, and Security agents run in parallel. Synthesis agent combines all perspectives into a detailed GSD-style PLAN.md with Tensions section.</description>
    <location>.wednesday/skills/greenfield/SKILL.md</location>
  </skill>
  <skill>
    <name>pr-create</name>
    <description>Agent-driven PR creation skill. Validates branch, runs pre-push checklist, generates GIT-OS compliant PR title and body from commit history, detects stacked branches, then pushes and opens the PR via gh CLI.</description>
    <location>.wednesday/skills/pr-create/SKILL.md</location>
  </skill>
  <skill>
    <name>pr-review</name>
    <description>Fix engine for PR review comments. Fetches review comments (Gemini bot or human), categorizes by impact, posts a prioritized fix queue, and applies fixes on dev approval. Called directly for quick fixes, or internally by pr-review-agent as part of full PR review.</description>
    <location>.wednesday/skills/pr-review/SKILL.md</location>
  </skill>
  <skill>
    <name>sprint</name>
    <description>Sprint initiation skill. Given a ticket title and description, outputs a GIT-OS-compliant branch name, PR title, and PR description template.</description>
    <location>.wednesday/skills/sprint/SKILL.md</location>
  </skill>
  <skill>
    <name>wednesday-design</name>
    <description>Design and UX guidelines for Wednesday Solutions projects. Covers visual design tokens, animation patterns, component standards, accessibility, and user experience best practices for React/Next.js applications. ENFORCES use of approved component libraries only.</description>
    <location>.wednesday/skills/wednesday-design/SKILL.md</location>
  </skill>
  <skill>
    <name>wednesday-dev</name>
    <description>Technical development guidelines for Wednesday Solutions projects. Enforces import ordering, complexity limits, naming conventions, TypeScript best practices, and code quality standards for React/Next.js applications.</description>
    <location>.wednesday/skills/wednesday-dev/SKILL.md</location>
  </skill>
</available_skills>

### How to Use Skills

When working on tasks, check if a relevant skill is available above. To activate a skill, read its SKILL.md file to load the full instructions.

For example:
- For code quality and development guidelines, read: .wednesday/skills/wednesday-dev/SKILL.md
- For design and UI component guidelines, read: .wednesday/skills/wednesday-design/SKILL.md

### Important

- The wednesday-design skill contains 492+ approved UI components. Always check the component library before creating custom components.
- The wednesday-dev skill enforces import ordering, complexity limits (max 8), and naming conventions.

## Codebase intelligence

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
- dep-graph.json for structure and relationships
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

## Development Workflow

### Git Workflow (Mandatory)
This project strictly follows the **GIT-OS** workflow. Before committing, read the `git-os` skill: `.wednesday/skills/git-os/SKILL.md`.

1. **Conventional Commits**: All commit messages must follow the format `type(scope): Description`.
   - Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`.
   - Description: Imperative mood ("Add login"), capitalized, no trailing period.
2. **No AI Fingerprints**: NEVER include `Co-Authored-By` lines or mention AI tools in commit messages. Commits must look human-authored.
3. **Atomic Commits**: Each commit should represent exactly one logical change.
4. **Branch Naming**: Use `feat/`, `fix/`, or `chore/` prefixes for branches.

### Quality Standards
- **Imports**: Follow the ordering enforced by `wednesday-dev`.
- **Complexity**: Keep function complexity below 8.
- **Naming**: Use descriptive camelCase for variables/functions.

<!-- WEDNESDAY_SKILLS_END -->