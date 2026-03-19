# Wednesday Agent Skills

AI skills for Wednesday Solutions projects — git discipline, PR automation, terminal dashboard, and greenfield planning.

---

## Install

**Option 1 — npx (no setup)**
```bash
npx @wednesday-solutions-eng/ai-agent-skills install
```

**Option 2 — global**
```bash
npm install -g @wednesday-solutions-eng/ai-agent-skills
wednesday-skills install
```

**Option 3 — shell (no npm)**
```bash
bash install.sh
```

Run in your project root. Done in seconds.

---

## What you get after install

| Feature | What it does |
|---------|-------------|
| `git-os` skill | Every agent follows conventional commits — no bad commit messages |
| `commit-lint` CI | GitHub Action blocks PRs with non-conventional commits |
| `pr-review` skill | Unified PR report — Gemini fix queue (6A), coverage health (6B), Sonar health (6C) |
| `triage` CI | GitHub Action that runs triage when Gemini bot posts a review |
| `greenfield` skill | Run `wednesday-skills plan` — 3 AI personas produce `PLAN.md` in minutes |
| `sprint` skill | Give a ticket → get branch name, PR title, and description template |
| `deploy-checklist` skill | Pre and post deploy verification checklist |
| `wednesday-dev` skill | Import ordering, complexity limits (max 8), naming conventions |
| `wednesday-design` skill | 492+ approved UI components, design tokens, animation patterns |

**Config files written automatically:**
- `CLAUDE.md` — Claude Code
- `GEMINI.md` — Gemini CLI
- `.cursorrules` — Cursor
- `.github/copilot-instructions.md` — GitHub Copilot
- `.wednesday/tools.json` — tool adapter config (sync target for Antigravity)

---

## CLI commands

```bash
wednesday-skills install                  # install + configure all agents
wednesday-skills install --skip-config    # install skills only
wednesday-skills configure . gemini       # re-configure a specific agent
wednesday-skills sync                     # re-sync all tool adapters
wednesday-skills sync --tool antigravity  # sync to Antigravity only
wednesday-skills dashboard                # launch terminal dashboard
wednesday-skills dashboard --pr 142       # focus dashboard on one PR
wednesday-skills plan                     # run greenfield planning
wednesday-skills list                     # list installed skills
```

---

## Terminal dashboard

```
wednesday-skills dashboard
```

Requires `GITHUB_TOKEN` env var. Shows:
- Active PRs and fix counts
- Triage queue per PR
- Installed skills
- OpenRouter usage and cost

Press `r` to refresh, `q` to quit.

---

## Greenfield planner

```bash
# Option 1: create BRIEF.md first
echo "Build a todo app with auth and teams" > BRIEF.md
wednesday-skills plan

# Option 2: pass brief inline
wednesday-skills plan --brief "Build a todo app with auth and teams"
```

Requires `OPENROUTER_API_KEY` in `.env`. Outputs `PLAN.md` and `CODEBASE.md`.

---

## Environment variables

Copy `.env.example` to `.env` and fill in:

```
OPENROUTER_API_KEY=   # required for plan + triage
GITHUB_TOKEN=         # required for dashboard PR panel
```

For GitHub Actions (triage), add `OPENROUTER_API_KEY` as a repo secret.

---

## Supported AI tools

| Tool | Configured via |
|------|---------------|
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| Antigravity | `~/.gemini/antigravity/skills/` (run `wednesday-skills sync`) |
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |

---

## Project layout after install

```
your-project/
├── CLAUDE.md
├── GEMINI.md
├── .cursorrules
├── .wednesday/
│   ├── tools.json
│   └── skills/
│       ├── git-os/
│       ├── pr-review/
│       ├── greenfield/
│       ├── sprint/
│       ├── deploy-checklist/
│       ├── wednesday-dev/
│       └── wednesday-design/
└── .github/
    └── workflows/
        ├── commit-lint.yml
        └── triage.yml
```

---

## Roadmap

See [Docs/ROADMAP.md](Docs/ROADMAP.md).

## License

MIT — Wednesday Solutions
