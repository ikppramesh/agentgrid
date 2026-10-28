## What & why

## Checklist
- [ ] Tests / evals added or updated (`npm test`, `npm run eval`)
- [ ] Tenant scoping: every new query filters by `tenantId` and goes through `authorize()`
- [ ] No secrets or raw PII in logs, URLs, or plaintext columns
- [ ] Migration is backwards-compatible (old code keeps working during deploy)
- [ ] Audit log entry for new privileged actions
