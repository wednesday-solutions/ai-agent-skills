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
    <name>codebase-intel</name>
    <description>
      Use for ALL codebase questions: what a module does, what breaks 
      if a file changes, risk scores, or structural lookups.
    </description>
    <location>.wednesday/skills/codebase-intel/SKILL.md</location>
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
- Prioritize querying via Bash: `wednesday-skills query <type> [args]`
- `MASTER.md` for architecture, data flow, danger zones
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