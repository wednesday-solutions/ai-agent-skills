---
name: sprint
description: Sprint initiation skill. Given a ticket title and description, outputs a GIT-OS-compliant branch name, PR title, and PR description template.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
---

# Sprint Initiation Skill

## Trigger

Load this skill when a dev provides a **ticket** and wants to start working on it:
- "Start this ticket"
- "Set up WED-142"
- "Create a branch for this issue"
- "Give me the branch name and PR template for this ticket"

**Do NOT use this skill for:** actually creating the PR on GitHub (use `pr-create`), or planning a new project from scratch (use `greenfield`). This skill only outputs text — it does not push anything.

---

## Input

Provide the ticket title and description (from Linear, Jira, GitHub Issues, etc.).

## Output

### Branch name

Follow GIT-OS format:

```
feat/<short-kebab-name>
fix/<short-kebab-name>
chore/<short-kebab-name>
```

Rules:
- Kebab-case only
- Max 40 characters
- Derive from ticket title — no ticket numbers in branch name
- Use the correct type based on ticket intent

### PR title

Same format as a conventional commit subject line:

```
feat(scope): Add user authentication flow
fix(auth): Prevent token expiry crash
```

### PR description template

```markdown
### Ticket Link
<link to ticket>

---

### Related Links


---

### Description
<what changed and why>

---

### Steps to Test
1.
2.
3.

---

### GIFs

---
```

## Tools

| Action | Tool |
|--------|------|
| Create the branch | `Bash` — `git checkout -b <branch>` |
| Output branch name, PR title, description | Text response — no file writes needed |

## Example

**Ticket:** "Add password reset email flow"

**Output:**
```
Branch:  feat/password-reset-email
PR title: feat(auth): Add password reset email flow
```

Then fill the PR description template with ticket details.
