import { db } from "@/lib/db";
import { checkHealth } from "@/lib/health";
import { safeEqual } from "@/lib/crypto";
import { currentPeriod } from "@/lib/metering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prometheus exposition (scraped by local Prometheus → Grafana). Bearer METRICS_TOKEN. */
export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${token}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const h = await checkHealth();
  const since = new Date(Date.now() - 3600_000);
  const [usage, convByStatus, lastHour] = await Promise.all([
    db.usageRecord.findMany({ where: { period: currentPeriod() }, include: { tenant: { select: { slug: true } } } }),
    db.conversation.groupBy({ by: ["status"], _count: true }),
    db.message.aggregate({ where: { createdAt: { gte: since }, latencyMs: { not: null } }, _avg: { latencyMs: true }, _count: true }),
  ]);
  const lines = [
    "# TYPE agentgrid_up gauge",
    `agentgrid_up{component="db"} ${h.dbOk ? 1 : 0}`,
    `agentgrid_up{component="redis"} ${h.redisOk ? 1 : 0}`,
    "# TYPE agentgrid_queue_jobs gauge",
    ...Object.entries(h.queue).map(([state, n]) => `agentgrid_queue_jobs{state="${state}"} ${n}`),
    "# TYPE agentgrid_conversations gauge",
    ...convByStatus.map((c) => `agentgrid_conversations{status="${c.status}"} ${c._count}`),
    "# TYPE agentgrid_llm_latency_ms_avg gauge",
    `agentgrid_llm_latency_ms_avg ${lastHour._avg.latencyMs ?? 0}`,
    "# TYPE agentgrid_usage_total counter",
  ];
  for (const u of usage) {
    for (const k of ["messagesIn", "messagesOut", "llmInputTokens", "llmOutputTokens", "workflowRuns"] as const) {
      lines.push(`agentgrid_usage_total{tenant="${u.tenant.slug}",kind="${k}"} ${u[k]}`);
    }
  }
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; version=0.0.4" } });
}
