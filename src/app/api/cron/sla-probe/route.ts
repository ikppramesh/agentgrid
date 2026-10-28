import { db } from "@/lib/db";
import { checkHealth } from "@/lib/health";
import { handleError, json, requireCron } from "@/lib/http";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/** Synthetic availability probe every 5 min → uptime % on the SLA page. */
export async function GET(req: Request) {
  try {
    requireCron(req);
    const h = await checkHealth();
    if (h.dbOk) {
      await db.slaProbe.create({
        data: { ok: h.ok && h.queue.ready < 5000, dbMs: h.dbMs, redisMs: h.redisMs, queueDepth: h.queue.ready, deadLetters: h.queue.dead },
      });
    }
    if (!h.ok || h.queue.dead > 0) log.warn("sla.probe_degraded", h);
    return json(h, h.ok ? 200 : 503);
  } catch (err) {
    return handleError(err);
  }
}
