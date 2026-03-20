---
name: pr-create
description: Agent-driven PR creation skill. Validates branch, runs pre-push checklist, generates GIT-OS compliant PR title and body from commit history, detects stacked branches, then pushes and opens the PR via gh CLI.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
---

# PR Create — Agent-Driven Pull Request Skill

## Trigger

Load this skill when a dev wants to **push code and open a pull request**:
- "Create a PR"
- "Open a PR"
- "Push and create PR"
- "Submit this for review"
- "Ship this branch"

**Do NOT use this skill for:** generating a branch name from a ticket (use `sprint`), or applying review fixes after a PR is open (use `pr-review`). This skill runs at the end of a feature — code is already written and committed.

Read `.wednesday/skills/git-os/SKILL.md` before doing anything.

## Flow

```
1. Validate branch name
2. Run pre-push checklist
3. Extract ticket ID
4. Generate PR title from commit history
5. Detect stacked branch
6. Build PR body
7. git push + gh pr create
8. Return PR URL
```

---

## Step 1 — Validate Branch Name

Current branch must match: `feat|fix|chore|test|hotfix/<name>`

```bash
git branch --show-current
```

If it does not match — explain the correct format and **stop**. Do not proceed.

Example valid names: `feat/user-auth`, `fix/WED-142-token-crash`, `chore/update-deps`

---

## Step 2 — Pre-Push Checklist

Run in order. Stop and show the error output if any command fails.

```bash
npm run lint
npm run format:check
npm run test
npm run build
```

If a project does not have one of these scripts, skip it and note it was skipped.

---

## Step 3 — Extract Ticket ID

Look for a Jira/Linear ticket pattern in the branch name: `[A-Z]+-\d+`

```
feat/WED-142-oauth   → WED-142
fix/PROJ-88-crash    → PROJ-88
feat/add-auth        → (no ticket)
```

---

## Step 4 — PR Title

Get the first commit on this branch that is not in the base branch:

```bash
git log --reverse --format="%s" $(git merge-base HEAD origin/main)..HEAD | head -1
```

The PR title IS this commit subject. It already follows GIT-OS format.

---

## Step 5 — Detect Stacked Branch

Get the divergence point from main:

```bash
git merge-base HEAD origin/main
```

Check if any remote branch (not main, not the current branch) has this exact commit as its tip:

```bash
git branch -r --format="%(refname:short) %(objectname:short)"
```

If a match is found → base branch is that feature branch (stacked PR).
If no match → base branch is `main`.

---

## Step 6 — PR Body

Use the GIT-OS template. Fill what you can from context, leave placeholders for the dev.

```markdown
### Ticket Link
<Linear/Jira URL if ticket ID found in branch name, otherwise: "_No ticket — add link if applicable_">

---

### Description
<Summarise the commits on this branch in 2-3 sentences>

<If stacked>
> **Stacked PR** — base branch is `<base>`. Merge `<base>` first, then merge this.
</If stacked>

---

### Steps to Test
<!-- Fill in before requesting review -->

---

### GIFs
<!-- Add screen recordings if UI changes -->
```

---

## Step 7 — Push and Create PR

```bash
git push origin <current-branch>
gh pr create --title "<title>" --base <base> --body "<body>"
```

Return the PR URL from the `gh pr create` output.

---

## Tools

| Action | Tool |
|--------|------|
| All git and gh CLI commands | `Bash` |
| Read `package.json` to check available scripts | `Read` |
| Read `git-os` SKILL.md | `Read` |

## Error Handling

| Situation | Action |
|-----------|--------|
| Branch name invalid | Explain correct format, stop |
| Pre-push check fails | Show full error output, stop |
| `gh` not installed | Tell dev to install GitHub CLI: `brew install gh` |
| Push fails (upstream conflict) | Show error, suggest `git pull --rebase` |
| PR already exists | Show existing PR URL, stop |
