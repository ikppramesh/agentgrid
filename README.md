# AgentGrid

Multi-tenant platform for AI customer-engagement agents: businesses and agencies deploy
agents that qualify leads, book appointments, answer questions from a knowledge base and
hand over to humans — across web chat, Telegram, and any webhook-capable channel
(WhatsApp / Messenger / SMS bridges).

**Stack:** Next.js 15 (App Router) on Vercel · Postgres (Prisma) · Redis (Vercel Redis / Upstash) ·
Claude (Anthropic API) for grounded answers · deterministic NLU + dialogue manager.

## What's in the box

| Area | Implementation |
|---|---|
| Multi-tenancy | Agency → client tenants, per-tenant envelope encryption keys, every query tenant-scoped (`src/lib/auth/access.ts`) |
| Channels | Web chat widget (`/widget.js`), Telegram bot, signed generic webhook in/out (WhatsApp bridge) — normalized to one event model |
| Queueing | Every webhook → Redis queue with idempotency keys, retries + exponential backoff, dead-letter queue, crash recovery, per-conversation ordering (`src/lib/queue`) |
| Conversational stack | Template-driven NLU (intents/entities) → slot-filling dialogue manager → response generator (knowledge retrieval + Claude, guardrails, caching) |
| Workflows | CRM upsert (HubSpot, CRM webhook), booking / payment links, signed event webhooks (`lead.qualified`, `conversation.handover`) |
| Human handover | Low confidence, explicit request, emergencies, quota → console with transcript, captured details, take-over / return-to-bot / resolve |
| Agency features | White-label branding, client workspaces, sandbox mode, suspend, reseller usage dashboard |
| Auth | Password (bcrypt, rate-limited) + per-tenant OIDC SSO (PKCE, JIT provisioning, domain allow-list, enforce-SSO), revocable sessions, RBAC |
| Metering & SLA | Monthly usage per tenant (messages, conversations, LLM tokens, workflow runs), plan quotas, SLA tiers with probes and breach reporting |
| Model ops | Versioned prompts stamped on every answer, offline eval suite (CI gate), human intent labeling → dataset export, drift + guardrail dashboards |
| Security & compliance | AES-256-GCM envelope encryption, PII redaction (storage/logs/LLM), consent capture, DSAR export, right to erasure, retention jobs, audit log, CSP/HSTS, CSRF, HMAC webhooks — see `docs/SECURITY.md`, `docs/COMPLIANCE.md` |
| CI/CD | GitHub Actions: typecheck, lint, tests, evals, build, audit, gitleaks, CodeQL; Vercel preview per PR; production via blue/green promote after smoke test |

## Run locally

Prerequisites: Node 20+, Postgres, Redis (or `docker compose up -d`).

```bash
cp .env.example .env            # fill MASTER_KEY / SESSION_SECRET / CRON_SECRET (openssl rand -base64 32)
npm install
npx prisma migrate dev          # create schema
npm run db:seed                 # demo agency + clients; prints admin login
npm run dev                     # http://localhost:3000
npm run worker                  # optional: continuous queue worker (Vercel uses cron + after())
```

Without `ANTHROPIC_API_KEY` the platform runs fully deterministically (retrieval answers + handover).
Add a key to enable grounded LLM answers (`LLM_MODEL`, default `claude-opus-5-5`; `LLM_EFFORT=low` for chat latency).

### Try the channels

- **Web chat:** Agents → open an agent → *Open test chat*, or embed
  `<script src="https://<app>/widget.js" data-channel="<channelId>" async></script>`.
- **Telegram:** Agents → *Connect Telegram bot* with a @BotFather token (needs a public `APP_URL`, e.g. your Vercel URL or an ngrok tunnel).
- **WhatsApp via webhook:** Agents → *Webhook channel*. Your bridge POSTs
  `{"messageId","from":{"id","name"},"text"}` to `/api/channels/webhook/<id>` with header
  `X-AgentGrid-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`; replies are POSTed to your outbound URL signed the same way.

## Quality gates

```bash
npm run typecheck && npm run lint && npm test && npm run eval && npm run build
npm run eval -- --live      # also grades Claude answers (needs ANTHROPIC_API_KEY + REDIS_URL)
npm run dataset:export -- --tenant <id>   # PII-redacted NLU dataset with human labels
```

## Deploy (Vercel + Redis)

See `docs/RUNBOOK.md` → *First deployment*. Crons (`vercel.json`): queue worker every minute,
SLA probe every 5 min, retention daily. Per-minute crons need a Vercel Pro plan; on Hobby, the
`after()` drain still processes messages instantly and retries run once a day.

## Docs

- `docs/ARCHITECTURE.md` — components, message lifecycle, queue design, phase roadmap
- `docs/SECURITY.md` — threat model & controls
- `docs/COMPLIANCE.md` — GDPR / DPDP / HIPAA posture, data map, DSAR & erasure
- `docs/SLA.md` — tiers, measurement, credits
- `docs/RUNBOOK.md` — deploy, rotate keys, incidents, dead letters
