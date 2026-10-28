import { after } from "next/server";
import { enqueue } from "@/lib/queue/queue";
import { drain } from "@/lib/queue/worker";
import { rateLimit } from "@/lib/ratelimit";
import { planFor } from "@/lib/plans";
import { log, errorFields } from "@/lib/logger";
import { JOB, type InboundEvent } from "./events";
import { registerJobs } from "./jobs";

/**
 * Every webhook goes through here:
 *   verify (caller) → rate-limit → enqueue with idempotency key → 200 fast
 *   → drain the queue after the response is sent (Vercel `after`, no added latency).
 * If the function dies, the Vercel Cron worker picks the job up within a minute.
 */
export async function ingest(ev: InboundEvent, planId: string) {
  const rl = await rateLimit(`tenant:${ev.tenantId}`, planFor(planId).ratePerMinute);
  if (!rl.allowed) return { status: 429 as const };
  const res = await enqueue(JOB.inbound, ev.tenantId, ev, { idempotencyKey: `in:${ev.channelId}:${ev.externalMessageId}` });
  if (res.enqueued) {
    after(async () => {
      try {
        registerJobs();
        await drain(Number(process.env.QUEUE_DRAIN_BUDGET_MS ?? 8000));
      } catch (err) {
        log.error("ingest.drain_failed", errorFields(err));
      }
    });
  }
  return { status: 200 as const, duplicate: !res.enqueued };
}
