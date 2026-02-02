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

### Option 1: Using the install script

```bash
# Download and extract
curl -L https://github.com/wednesday-solutions/agent-skills/releases/latest/download/wednesday-agent-skills.tar.gz | tar -xz

# Run installer
./wednesday-agent-skills/install.sh
```

### Option 2: Manual installation

```bash
# Extract to your project root
tar -xzf wednesday-agent-skills.tar.gz

# Move skills to .wednesday directory
mkdir -p .wednesday/skills
cp -r wednesday-agent-skills/wednesday-dev .wednesday/skills/
cp -r wednesday-agent-skills/wednesday-design .wednesday/skills/

# Clean up
rm -rf wednesday-agent-skills
```

### Option 3: Git submodule (for updates)

```bash
git submodule add https://github.com/wednesday-solutions/agent-skills.git .wednesday/skills
```

## Directory Structure After Installation

```
your-project/
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
- **Claude Code** (Anthropic)
- **Cursor** (cursor.com)
- **Gemini CLI** (Google)
- **GitHub Copilot Workspace**
- **Amp** (Sourcegraph)
- Any tool supporting the [Agent Skills](https://agentskills.io) format

## Usage

Once installed, AI assistants will automatically discover and apply these guidelines when working on your project.

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

## Updating

### If installed via tarball

```bash
# Download latest and reinstall
curl -L https://github.com/wednesday-solutions/agent-skills/releases/latest/download/wednesday-agent-skills.tar.gz | tar -xz
./wednesday-agent-skills/install.sh
```

### If installed via submodule

```bash
git submodule update --remote .wednesday/skills
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes to the skill files
4. Submit a pull request

## License

MIT License - Wednesday Solutions

## Links

- [Agent Skills Specification](https://agentskills.io/specification)
- [Wednesday Solutions](https://wednesday.is)
- [Report Issues](https://github.com/wednesday-solutions/agent-skills/issues)
