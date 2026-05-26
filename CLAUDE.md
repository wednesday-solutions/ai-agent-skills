# Project Guidelines

<!-- WEDNESDAY_SKILLS_START -->
## Wednesday Agent Skills

This project uses Wednesday Solutions agent skills for consistent code quality and design standards.

### Available Skills

<available_skills>
  <skill>
    <name>codebase-intel</name>
    <description>Unified codebase intelligence. Handles all questions about structure, logic, risk, and dependencies. Combines natural-language Q&A with deterministic lookups and pre-edit blast radius checks.</description>
    <location>.wednesday/skills/codebase-intel/SKILL.md</location>
  </skill>
  <skill>
    <name>deploy-checklist</name>
    <description>Pre-deploy and post-deploy checklist skill. Ensures env vars, migrations, CI, rollback plan, smoke tests, and monitoring are verified before and after every deployment.</description>
    <location>.wednesday/skills/deploy-checklist/SKILL.md</location>
  </skill>
  <skill>
    <name>wednesday-git</name>
    <description>Unified Git workflow. Manages the entire task lifecycle: branch creation (sprint), atomic commits (git-os), and PR opening (pr-create).</description>
    <location>.wednesday/skills/wednesday-git/SKILL.md</location>
  </skill>
  <skill>
    <name>greenfield</name>
    <description>Parallel persona planning for new projects. Research agent runs first to build domain context, then Architect, PM, and Security agents run in parallel. Synthesis agent combines all perspectives into a detailed GSD-style PLAN.md with Tensions section.</description>
    <location>.wednesday/skills/greenfield/SKILL.md</location>
  </skill>
  <skill>
    <name>pr-review</name>
    <description>Fix engine for PR review comments. Fetches review comments (Gemini bot or human), categorizes by impact, posts a prioritized fix queue, and applies fixes on dev approval. Called directly for quick fixes, or internally by pr-review-agent as part of full PR review.</description>
    <location>.wednesday/skills/pr-review/SKILL.md</location>
  </skill>
  <skill>
    <name>standards-kit</name>
    <description>Unified development and design standards. Enforces code quality (complexity < 8), naming conventions, and mandatory component library usage.</description>
    <location>skills/standards-kit/SKILL.md</location>
  </skill>
</available_skills>

### How to Use Skills

When working on tasks, check if a relevant skill is available above. To activate a skill, read its SKILL.md file to load the full instructions.

For example:
- For architectural logic or design standards, read: skills/standards-kit/SKILL.md
- For Git workflow and PR standards, read: skills/wednesday-git/SKILL.md

### Important

- **Standards Hub**: The `standards-kit` is the single source of truth for both logic (max complexity 8) and visuals (approved component libraries only).
- **Mandatory References**: Always check the `/references` directory within the kit for specific remediation strategies or styling tokens.

## Codebase intelligence

If .wednesday/graph.db exists, this project has been analyzed.
Use these skills for all structural questions:

<available_skills>
  <skill>
    <name>codebase-intel</name>
    <description>
      Unified codebase intelligence. Handles all questions about structure, 
      logic, risk, and dependencies. Combines natural-language Q&A 
      with deterministic lookups and pre-edit blast radius checks.
    </description>
    <location>.wednesday/skills/codebase-intel/SKILL.md</location>
  </skill>
</available_skills>

## Rules for codebase questions
- Prioritize querying via Bash: `wednesday-skills query <type> [args]`
- `MASTER.md` for architecture, data flow, danger zones
- Graph updates automatically on every commit via post-commit hook

## Mapping the codebase
If asked to "map the codebase", "analyse the codebase", "understand the codebase",
or "build the knowledge graph" — run via Bash tool:
  wednesday-skills map --full

## 🏗️ Permanent Standards

### 1. Unified Development Standards
- **Complexity**: Maximum allowed cyclomatic complexity is **8**.
- **Naming**: 
    - **PascalCase**: React components, Types, Interfaces, Classes.
    - **camelCase**: Functions, variables, hooks, object properties.
    - **UPPER_SNAKE_CASE**: Constants and Enums.
- **Imports**: Strict ordering: React -> Next -> State -> UI -> Alias (@/) -> External -> Internal -> Relative.
- **Forbidden**: No `console.log`, no magic numbers, no unused code/imports.
- **Graph Safety**: Use `@wednesday-skills:connects-to` or `@wednesday-skills:global` for dynamic patterns.

### 2. Unified Design Standards
- **MANDATORY**: DO NOT create custom UI components. Use the approved library ONLY (shadcn, Aceternity, Magic UI, etc.).
- **Aesthetic**: Premium, minimal, with Green (#4ADE80) to Teal (#0D9488) gradients for primary actions.
- **Animations**: Performance-first (transform/opacity only). Duration: 200-300ms for hover, 300ms for transitions.
- **Typography**: Instrument Serif for display, DM Sans for body.

### 3. Git Workflow (GIT-OS)
- **Conventional Commits**: `type(scope): Description` (e.g., `feat(auth): Add login`).
- **Atomic Commits**: One logical change per commit.
- **PR Limits**: Maximum **6 files** per PR. Suggest splitting if exceeded.
- **Branch Naming**: `type/name-of-task` (e.g., `feat/improving-reads`). No ticket numbers.

<!-- WEDNESDAY_SKILLS_END -->