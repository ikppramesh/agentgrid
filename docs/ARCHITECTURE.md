# Architecture

```
 Web chat widget ─┐                                   ┌─► Telegram Bot API
 Telegram webhook ─┼─► Channel adapters ─► Redis queue ─► Worker ─┼─► Webhook bridge (WhatsApp…)
 Signed webhook ───┘   verify + normalize   (idempotent)   │      └─► (web chat polls)
                                                           ▼
                         NLU ─► Dialogue manager ─► Response generator ─► Guardrails
                                    │                 (knowledge + Claude)
                                    ├─► Workflow jobs ─► HubSpot / CRM webhook / event webhooks
                                    └─► Human handover ─► Agent console
 Control plane (Next.js console): tenants, RBAC, SSO, agents, knowledge, channels, metering, SLA, audit
 Data: Postgres (tenants, conversations, usage, audit) · Redis (queue, sessions, rate limits, caches)
```

## Message lifecycle

1. **Ingest** (`src/app/api/channels/*`, `src/app/api/webchat/*`): authenticate (Telegram secret token / HMAC
   signature / visitor UUID + consent), rate-limit per tenant plan, normalize to `InboundEvent`,
   `enqueue` with idempotency key `in:<channel>:<externalMessageId>`, return 2xx immediately.
2. **Drain**: `after()` drains the queue right after the response (no added latency);
   Vercel Cron `/api/queue/worker` every minute covers retries, delays and crashed invocations.
3. **Process** (`src/core/engine.ts`) under a per-conversation Redis lock (strict ordering):
   contact upsert & opt-out → conversation → store message (redacted + encrypted original) →
   quota → NLU → dialogue decision → (optional) knowledge + LLM answer → persist state →
   outbound messages enqueued as `outbound.deliver` jobs → workflow / handover / erasure jobs.
4. **Deliver**: channel send with typed failures — permanent (bot blocked, 4xx) → DLQ immediately;
   provider rate-limit → deferred by `retry_after`; transient → exponential backoff (2s…5min, jitter), max 5.

## Queue (`src/lib/queue/queue.ts`)

Redis lists + sorted sets: `q:ready` → `LMOVE` → `q:processing` with lease in `q:leases`; failures go to
`q:delayed` (score = run-at) or `q:dead`. `reclaimExpired` returns leased jobs whose worker died.
Semantics: at-least-once; handlers are idempotent (message `externalId`, `deliveredAt`, workflow idempotency keys).
Swap-in path for higher scale: Upstash QStash or Kafka behind the same `enqueue`/`register` API.

## Conversational design decisions

- **Deterministic first** — intents, slot filling, handover rules and workflows are code, so they are
  testable (`npm run eval`), cheap and predictable. Claude is used only to *phrase answers to open
  questions* grounded in the tenant's knowledge, with citations checked by guardrails.
- **Restricted templates** (healthcare) forbid improvisation; tenants can disable the cloud LLM entirely.
- **Graceful degradation** — LLM error, refusal, quota or disabled → retrieval answer or human handover.
- **No vector DB yet** — BM25-style keyword retrieval in Postgres behind `retrieve()`; Phase 2 swaps in
  embeddings (pgvector or a managed index) without touching callers.

## Phase roadmap (from the RFP)

| Phase | Status in this codebase |
|---|---|
| 1 — MVP: templated agents, web chat, messaging channel (Telegram in place of WhatsApp), CRM webhooks, agent console, managed LLM + rule-based dialogue | ✅ |
| 2 — Scale & integrations: multi-channel adapters (webhook bridge), workflow engine, RBAC, multi-tenant isolation, metering | ✅ (vector search deferred by decision) |
| 3 — Agency & hardening: white-label, client sandboxing, per-client config, reseller dashboard, SSO, usage metering, SLAs | ✅ |
| Next | Native WhatsApp Cloud API adapter, embeddings/RAG, Stripe billing from `UsageRecord`, MFA for password users, visual flow editor |
