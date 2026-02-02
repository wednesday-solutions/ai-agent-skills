# Wednesday Agent Skills

Pre-configured agent skills for Wednesday Solutions projects. These skills provide AI coding assistants (Claude Code, Cursor, etc.) with project-specific guidelines for code quality and design standards.

## What's Included

| Skill | Description |
|-------|-------------|
| `wednesday-dev` | Technical development guidelines (imports, complexity, naming) |
| `wednesday-design` | Design & UX guidelines (tokens, animations, components) |

### wednesday-dev
- Import ordering rules
- Cyclomatic complexity limits (max 8)
- Naming conventions (PascalCase, camelCase, UPPER_SNAKE_CASE)
- TypeScript best practices
- React patterns
- Testing requirements

### wednesday-design
- **492+ approved UI components** from 8 vetted libraries
- Design tokens (colors, typography, spacing, shadows)
- Animation patterns and easing functions
- Component styling patterns
- Accessibility requirements
- Performance guidelines

## Installation

### Option 1: Global Installation (Recommended)

Install globally to use the `wednesday-skills` command anywhere:

```bash
npm install -g @wednesday-solutions-eng/ai-agent-skills
```

Then run in your project directory:

```bash
wednesday-skills install
```

### Option 2: Using npx (No Installation)

Run directly without installing:

```bash
npx @wednesday-solutions-eng/ai-agent-skills install
```

## What Happens During Installation

The CLI does two things:

1. **Installs skill files** to `.wednesday/skills/`
2. **Configures AI agents** to discover the skills by creating/updating:
   - `CLAUDE.md` - For Claude Code
   - `.cursorrules` - For Cursor
   - `.github/copilot-instructions.md` - For GitHub Copilot

This ensures your AI assistants **actively know** about the skills and will use them.

## CLI Commands

```bash
# Install skills AND configure all agents (recommended)
wednesday-skills install

# Install skills to a specific directory
wednesday-skills install ./my-project

# Install skills without configuring agents
wednesday-skills install --skip-config

# Configure agents for already-installed skills
wednesday-skills configure

# Configure only a specific agent (claude, cursor, or copilot)
wednesday-skills configure . claude

# List available skills
wednesday-skills list

# Show help
wednesday-skills help
```

## Directory Structure After Installation

```
your-project/
├── CLAUDE.md                          # Claude Code configuration
├── .cursorrules                       # Cursor configuration
├── .github/
│   └── copilot-instructions.md        # GitHub Copilot configuration
├── .wednesday/
│   └── skills/
│       ├── wednesday-dev/
│       │   ├── SKILL.md
│       │   └── references/
│       │       ├── COMPLEXITY.md
│       │       └── NAMING.md
│       └── wednesday-design/
│           ├── SKILL.md
│           └── references/
│               ├── COMPONENT-LIBRARY.md
│               ├── TOKENS.md
│               ├── ANIMATIONS.md
│               └── COMPONENTS.md
├── src/
├── package.json
└── ...
```

## Supported AI Tools

These skills work with:
- **Claude Code** (Anthropic) - via `CLAUDE.md`
- **Cursor** (cursor.com) - via `.cursorrules`
- **GitHub Copilot** - via `.github/copilot-instructions.md`
- **Gemini CLI** (Google)
- **Amp** (Sourcegraph)
- Any tool supporting the [Agent Skills](https://agentskills.io) format

## How It Works

The installation generates an `<available_skills>` XML block that gets injected into each agent's configuration file:

```xml
<available_skills>
  <skill>
    <name>wednesday-dev</name>
    <description>Technical development guidelines...</description>
    <location>.wednesday/skills/wednesday-dev/SKILL.md</location>
  </skill>
  <skill>
    <name>wednesday-design</name>
    <description>Design and UX guidelines...</description>
    <location>.wednesday/skills/wednesday-design/SKILL.md</location>
  </skill>
</available_skills>
```

When AI agents see this in their system prompt, they know to read the SKILL.md files when working on relevant tasks.

## Usage

Once installed, AI assistants will discover and apply these guidelines when working on your project.

### Example Prompts

```
"Create a new button component"
→ AI will use approved components from the library (e.g., Shimmer Button from Magic UI)

"Add a hero section with text animation"
→ AI will use Text Generate Effect from Aceternity UI

"Fix the complexity in this function"
→ AI will apply refactoring strategies from the complexity guide
```

## Customization

### Extending the skills

You can add project-specific rules by editing the SKILL.md files:

```markdown
## Project-Specific Rules

- Use `@company/ui` for internal components
- All API calls go through `lib/api/client.ts`
```

### Overriding defaults

Create a `.wednesday/config.json` to override defaults:

```json
{
  "skills": {
    "wednesday-dev": {
      "complexity": {
        "max": 10
      }
    }
  }
}
```

### Re-running configuration

If you modify the skills or want to update agent configurations:

```bash
wednesday-skills configure
```

This will regenerate the agent configuration files with the latest skill metadata.

## Updating

If installed globally:

```bash
npm update -g @wednesday-solutions-eng/ai-agent-skills
wednesday-skills install
```

Or just use npx (always gets latest):

```bash
npx @wednesday-solutions-eng/ai-agent-skills@latest install
```

This will overwrite the existing skills and update agent configurations.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes to the skill files
4. Submit a pull request

## License

MIT License - Wednesday Solutions

## Links

- [npm Package](https://www.npmjs.com/package/@wednesday-solutions-eng/ai-agent-skills)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Wednesday Solutions](https://wednesday.is)
- [Report Issues](https://github.com/wednesday-solutions/ai-agent-skills/issues)
