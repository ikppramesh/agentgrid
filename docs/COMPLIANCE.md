# Compliance (GDPR · India DPDP Act 2023 · HIPAA-readiness)

This document describes technical measures implemented in the platform. It is not legal advice;
tenants remain controllers of their customers' data and AgentGrid acts as processor.

## Data map

| Data | Where | Protection | Retention |
|---|---|---|---|
| Message text | `Message.text` (redacted) + `Message.textEnc` (original, encrypted) | AES-256-GCM per-tenant key | Tenant `retentionDays` (default 180), daily purge |
| Captured lead details (name, phone, email, slots) | `Contact.profileEnc` | Encrypted | Until erasure / tenant deletion |
| Channel & integration credentials | `Channel.credentialsEnc`, `Integration.configEnc`, `SsoConfig.clientSecretEnc` | Encrypted | Until removed |
| Consent | `Contact.consentAt`, `consentText` | — | With contact |
| Audit log | `AuditLog` (PII-redacted meta) | — | 400 days |
| Usage / billing | `UsageRecord` (aggregates, no PII) | — | Indefinite |
| Logs | Vercel log drains | Structured, PII-redacted, secrets masked | Per log provider |

## Data-subject rights

- **Notice & consent:** web chat requires explicit opt-in before the first message; messaging channels receive a one-time AI/processing notice.
- **Access (Art. 15 / DPDP s.11):** `GET /api/privacy/:tenantId/contacts/:contactId` (console: *Export data*), audited.
- **Erasure (Art. 17 / DPDP s.12):** `DELETE` on the same URL, or the customer types “delete my data”; messages and conversations hard-deleted, contact scrubbed, audited.
- **Objection / opt-out:** `STOP` / “unsubscribe” stops all processing and replies until the customer sends START.
- **Storage limitation:** configurable retention per tenant, enforced daily by `/api/cron/retention`.
- **Data minimisation:** LLM receives redacted text and only the top-k knowledge snippets; no CRM records are sent to the model.

## Regulated tenants (healthcare — HIPAA / sensitive data)

- Restricted templates never improvise answers and escalate emergencies to humans.
- *Allow cloud LLM* can be switched off per tenant → fully deterministic processing, no data leaves the platform except to configured channels/integrations.
- For HIPAA workloads: sign a BAA with each sub-processor (hosting, database, Anthropic if LLM enabled) or run with LLM off on BAA-covered infrastructure; enable SSO enforcement.

## Sub-processors (typical deployment)

Vercel (hosting) · Postgres provider (Neon / Supabase / RDS) · Redis provider (Vercel Redis / Upstash) ·
Anthropic (LLM, if enabled) · Telegram / WhatsApp providers (channels the tenant connects) · CRM the tenant connects.
