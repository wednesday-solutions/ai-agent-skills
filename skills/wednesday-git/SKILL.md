---
name: wednesday-git
description: Unified Git workflow. Manages the entire task lifecycle: branch creation (sprint), atomic commits (git-os), and PR opening (pr-create).
permissions:
  allow:
    - Bash(git *)
    - Bash(gh *)
    - Bash(npm run *)
    - Bash(npx --no-install commitlint *)
    - Read(.wednesday/config.json)
---

# Wednesday Git Workflow (GIT-OS)

This skill manages the complete lifecycle of a feature or fix. It ensures that every branch, commit, and PR follows the project's quality and automation standards.

## Lifecycle Phases

### 1. Starting a Task (`sprint`)
When a dev provides a ticket and wants to start working:
- **Action**: Create a branch following the `type/name` format (e.g., `feat/user-auth`).
- **Rule**: Max 40 characters, kebab-case, no ticket numbers in the branch name.
- **Tool**: `Bash(git checkout -b <branch_name>)`

### 2. Committing Changes (`git-os`)
When code is ready for an atomic commit:
- **Format**: `type(scope?): Description` (e.g., `feat(auth): Add login endpoint`).
- **Types**: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `chore`.
- **Atomic Rule**: One logical change per commit. If you've done multiple things, split them into separate commits.
- **Human-Authored**: NEVER include AI attribution or fingerprints.
- **Linting**: Before committing, ensure `npx --no-install commitlint` would pass.

### 3. Opening a Pull Request (`pr-create`)
When the task is finished and ready for review:
- **Pre-Push Checklist**: Run `npm run lint`, `format:check`, `test`, and `build`.
- **Validation**:
    - **Max 6 files per PR**: If the PR is larger, suggest splitting it.
    - **Conventional Title**: Title must match `type(scope): Description`.
- **Metadata**: Extract ticket ID from branch name (e.g., `WED-142`).
- **PR Description Template**:
    ```markdown
    ### Ticket Link
    ---
    ### Description
    ---
    ### Steps to Test
    ---
    ### GIFs (if applicable)
    ---
    ```
- **Push & Create**:
    1. `Bash(git push origin <branch>)`
    2. `Bash(gh pr create --title "<title>" --body "<body>")` using the template above.

---

## 🚫 Never
- **Direct Commits**: Never commit directly to `main` or `develop`.
- **Dirty History**: Never bundle multiple concerns into one commit.
- **Skip Checks**: Never open a PR without running the full pre-push checklist.
- **AI Fingerprints**: Never use "AI-generated" descriptions or co-author tags.

## ⚠️ Safety Thresholds
- **Risk > 80**: If the `codebase-intel` risk score is > 80, require explicit confirmation before pushing.
- **Quality Gate**: If Sonar is enabled and the quality gate fails, STOP — do not push.

## 🛠 Tools
- `Bash` for all `git` and `gh` operations.
- `Read` for `package.json` and `.wednesday/config.json` to check for project-specific automation.
