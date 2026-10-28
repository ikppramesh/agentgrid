# Runbook

## First deployment (Vercel + Redis + Postgres)

1. `vercel link` the repo. In Vercel → Storage add **Redis** (sets `REDIS_URL`) and a **Postgres** (Neon) database (`DATABASE_URL`).
2. Set env vars (Production + Preview): `APP_URL`, `MASTER_KEY`, `SESSION_SECRET`, `CRON_SECRET`, `METRICS_TOKEN`,
   `ANTHROPIC_API_KEY`, `LLM_MODEL`, `LLM_EFFORT`. Generate secrets with `openssl rand -base64 32`. Use different values per environment.
3. GitHub repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; create GitHub environments `preview` and `production` (add required reviewers to production).
4. Push to `main` → CI → deploy workflow builds, runs `prisma migrate deploy`, deploys without traffic, smoke-tests `/api/health`, promotes.
5. Seed or create the first owner: `DATABASE_URL=… npm run db:seed` (prints credentials), then change the password / configure SSO.
6. Uptime monitor on `GET /api/health`; optional Prometheus scrape of `/api/metrics` with `Authorization: Bearer $METRICS_TOKEN`.

## Rollback

`vercel rollback` (or promote the previous deployment in the dashboard). Migrations are forward-only and must stay backwards-compatible with the previous release.

## Dead letters

Console → *SLA & usage* → *Dead letters* shows failed jobs for the workspace with the last error; fix the cause (e.g. CRM token) and *Replay*.
Platform-wide: `redis-cli LLEN q:dead`.

## Incidents

| Symptom | Check | Action |
|---|---|---|
| Bots not replying | `/api/health`, queue `ready` count on SLA page, Vercel cron logs | If Redis down → fix provider; jobs are retained and drain on recovery |
| Telegram silent | `getWebhookInfo` for the bot; channel active? | Re-connect bot in console (re-registers webhook) |
| LLM errors (`llm.failed` logs) | Anthropic status, quota page | Platform degrades to retrieval/handover automatically; set `LLM_ENABLED=false` to force |
| Spike in handovers | Model ops page: low-confidence rate, intents | Add knowledge / keywords, label intents, re-run `npm run eval` |

## Key rotation

- **Channel / integration secrets:** recreate in console; old ones are deleted.
- **SESSION_SECRET:** rotate in Vercel and redeploy (forces all users to sign in again).
- **MASTER_KEY:** write a migration script that unwraps each `Tenant.wrappedDataKey` with the old key and re-wraps with the new (data itself need not be re-encrypted), then swap the env var.
