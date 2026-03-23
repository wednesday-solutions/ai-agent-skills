---
name: deploy-checklist
description: Pre-deploy and post-deploy checklist skill. Ensures env vars, migrations, CI, rollback plan, smoke tests, and monitoring are verified before and after every deployment.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
permissions:
  allow:
    - Bash(npm run lint)
    - Bash(npm run format:check)
    - Bash(npm run test)
    - Bash(npm run build)
    - Bash(curl *)
    - Bash(gh run list)
    - Bash(gh pr checks)
---

# Deploy Checklist Skill

## Trigger

Load this skill when a dev is about to deploy or has just deployed:
- "We're deploying to production"
- "Pre-deploy check"
- "Post-deploy verification"
- "Run the deploy checklist"
- "Is it safe to deploy?"

**Do NOT use this skill for:** committing code (use `git-os`), creating a PR (use `pr-create`), or planning a project (use `greenfield`). This skill only applies at the deployment stage — code is already merged.

---

Run this checklist before and after every production deployment.

## Pre-Deploy Checklist

- [ ] All CI checks green on the deploy branch
- [ ] Environment variables verified in target environment (no missing keys)
- [ ] Database migrations reviewed — irreversible migrations documented
- [ ] Migrations have been dry-run or tested in staging
- [ ] Rollback plan documented: what to revert and how
- [ ] Feature flags set correctly for the release
- [ ] Downstream services notified if API contracts changed
- [ ] Changelog updated with this release's changes
- [ ] Deployment window confirmed (avoid peak traffic)

## Deploy

- [ ] Deploy initiated with correct branch / tag
- [ ] Deployment logs monitored in real time
- [ ] No unexpected errors during startup

## Post-Deploy Checklist

- [ ] Smoke test: critical user flows verified manually or via synthetic monitoring
- [ ] Health check endpoint returns 200
- [ ] Error rate in monitoring (Datadog, Grafana, Sentry) is normal
- [ ] No spike in latency or DB query time
- [ ] Monitoring alerts reviewed — no new alerts triggered
- [ ] Changelog published / communicated to stakeholders
- [ ] Ticket status updated (closed / released)

## Rollback Trigger Criteria

Initiate rollback immediately if:
- Error rate rises above 1% of requests
- P95 latency increases by more than 2x baseline
- Any data integrity issue detected
- Critical feature path returns 5xx

## Tools

| Action | Tool |
|--------|------|
| Run lint, test, build scripts | `Bash` |
| Check health endpoint | `Bash` — `curl -s <url>/health` |
| Read config or env files | `Read` |
| Check CI status | `Bash` — `gh run list` or `gh pr checks` |

## Notes

- Never deploy on Fridays unless it's a critical hotfix
- Always have a second engineer available during production deploys
- Document the actual deploy time and outcome in the ticket
