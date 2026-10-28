# Service levels

| Plan | Availability | First-response p95 (automated) | Delivery success | Support response |
|---|---|---|---|---|
| Starter | 99.5% | 5 s | 99% | 48 h |
| Growth | 99.9% | 3 s | 99.5% | 12 h |
| Enterprise | 99.95% | 2 s | 99.9% | 2 h |

Defined in `src/lib/plans.ts`; the console's *SLA & usage* page compares actuals to targets.

**Measurement**
- *Availability:* synthetic probe every 5 minutes (`/api/cron/sla-probe`) checking database, Redis and queue backlog; uptime = ok probes / total probes over 30 days.
- *First response:* time from inbound receipt to first bot reply, per conversation (`Conversation.firstResponseMs`).
- *Delivery success:* outbound messages with `deliveredAt` / outbound messages (web chat counts as delivered on read).

**Exclusions:** scheduled maintenance announced 48 h ahead, third-party channel outages (Telegram/WhatsApp/CRM), tenant misconfiguration, quota exhaustion.

**Service credits (suggested):** 10% of monthly fee per 0.1% below target, capped at 50%.

Targets are commitments to measure against — not claimed results.
