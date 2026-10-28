# Security

## Controls

| Threat | Control | Where |
|---|---|---|
| Cross-tenant data access | Every tenant route/action calls `authorize(tenantId, permission)`; all queries filter by `tenantId`; foreign tenants return 404 (no enumeration) | `src/lib/auth/access.ts` |
| Privilege escalation | RBAC matrix (OWNER/ADMIN/OPERATOR/VIEWER); members cannot grant roles above their own | `src/lib/auth/rbac.ts`, `actions.ts` |
| Secret exposure | Bot tokens, webhook secrets, SSO client secrets, CRM tokens encrypted with per-tenant data keys (AES-256-GCM, AAD-bound to tenant), wrapped by `MASTER_KEY`. Secrets revealed once via 5-minute Redis tickets, never in URLs | `src/lib/crypto.ts`, `src/lib/reveal.ts` |
| PII leakage | Redacted text in plaintext columns, logs, analytics, exports and LLM prompts; originals encrypted; PII viewing requires `pii:read` and is audited; guardrails strip PII the customer didn't provide | `src/lib/pii.ts`, `src/core/guardrails.ts` |
| Forged webhooks / replay | Telegram `secret_token` (constant-time compare); generic webhooks HMAC-SHA256 with 5-min timestamp tolerance; idempotency keys | `src/app/api/channels/*` |
| Session theft / fixation | httpOnly, Secure, SameSite=Lax cookie; 8h JWT whose `jti` must exist in Redis (instant revocation on logout / member removal) | `src/lib/auth/session.ts` |
| CSRF | Server actions: Next.js origin check; cookie-auth API routes: Origin must match Host (middleware) | `src/middleware.ts` |
| Brute force / abuse | Login rate limits per account + IP; per-tenant inbound rate limits by plan; per-IP web chat limits; monthly quotas | `src/lib/ratelimit.ts`, `src/lib/metering.ts` |
| SSO attacks | OIDC code flow + PKCE + nonce + one-time state; ID token verified against issuer JWKS, audience, issuer; email must be verified and in allowed domains | `src/lib/auth/oidc.ts` |
| Prompt injection | Customer text wrapped as data in `<customer_message>`; model cannot trigger actions (workflows are decided by deterministic code); output guardrails; handover token | `src/core/prompts.ts` |
| Clickjacking / XSS | CSP (`frame-ancestors 'none'` for console), X-Frame-Options DENY, React escaping, no `dangerouslySetInnerHTML` | `next.config.ts` |
| Supply chain | Pinned versions, npm install-script allow-list, `npm audit` gate, Dependabot, CodeQL, gitleaks | `.github/` |

## Known gaps / next hardening steps

- MFA (TOTP/WebAuthn) for password accounts (`User.mfaRequired` reserved); recommend enforcing SSO for enterprise tenants meanwhile.
- `MASTER_KEY` from env; move to a KMS (AWS KMS / GCP KMS) for HSM-backed wrapping and rotation audit.
- CSP uses `'unsafe-inline'` for Next.js inline scripts; move to nonces.
- Web chat visitors are identified by an unguessable UUID in localStorage (no account) — fine for anonymous chat, not for authenticated customer data.

## Reporting

Report vulnerabilities privately to the maintainers; do not open public issues.
