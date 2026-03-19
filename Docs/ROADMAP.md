# Roadmap — Wednesday AI Agent Skills

---

## ~~Phase 1 — Org Foundation~~ ✓ Complete

> Git discipline, PR automation, terminal dashboard, greenfield planning.

| Subphase | Feature | Status |
|----------|---------|--------|
| ~~1A~~ | ~~GIT-OS skill — conventional commits enforced for every agent~~ | ~~Done~~ |
| ~~1A~~ | ~~commit-lint GitHub Action — CI blocks non-conventional commits~~ | ~~Done~~ |
| ~~1B~~ | ~~Gemini PR triage — comments scored 1–6, REVIEW_REPORT posted~~ | ~~Done~~ |
| ~~1B~~ | ~~`@agent fix #N` loop — dev approves, agent commits + pushes~~ | ~~Done~~ |
| ~~1C~~ | ~~Terminal dashboard — PRs, triage queue, skills, usage in one TUI~~ | ~~Done~~ |
| ~~1D~~ | ~~Greenfield planner — 3 parallel personas → PLAN.md + CODEBASE.md~~ | ~~Done~~ |
| ~~1D~~ | ~~Sprint skill — branch name, PR title, PR description from ticket~~ | ~~Done~~ |
| ~~1D~~ | ~~Deploy checklist skill — pre/post deploy verification~~ | ~~Done~~ |
| ~~1D~~ | ~~tools.json adapter layer — claude-code, gemini-cli, antigravity~~ | ~~Done~~ |
| ~~1D~~ | ~~GEMINI.md support — Gemini CLI configured on install~~ | ~~Done~~ |
| ~~1D~~ | ~~Antigravity adapter — file-copy to ~/.gemini/antigravity/skills/~~ | ~~Done~~ |

---

## Phase 2 — Brownfield Intelligence _(planned)_

> Understand existing codebases. Make AI useful on day one of a new engagement.

| Feature | Description |
|---------|-------------|
| Codebase scanner | Analyzes repo structure, generates `CODEBASE.md` for existing projects |
| Dependency audit skill | Flags outdated, vulnerable, or unlicensed packages |
| Tech debt mapper | Surfaces complexity hotspots and refactor candidates |
| Android / Kotlin support | Adapter for Android dev tooling |
| Brownfield planning skill | Persona agents aware of existing architecture constraints |

---

## Phase 3 — Public Skill Registry _(planned)_

> Let the community build and share skills. Make the system extensible.

| Feature | Description |
|---------|-------------|
| Public skill registry | Browse and install community skills via `wednesday-skills add <skill>` |
| Skill versioning | Pin skill versions, get update notifications |
| Model router | Auto-select cheapest model capable of the task |
| Agentic skill library | Multi-step agent workflows as installable skills |
| Skill authoring guide | Docs + templates for building your own skills |
