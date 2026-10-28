import { db } from "./db";

export function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/** KPIs from the pre-read, computed over a window (targets shown alongside, never claimed). */
export async function tenantKpis(tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const convos = await db.conversation.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: { status: true, qualified: true, firstResponseMs: true, handoverReason: true },
  });
  const total = convos.length;
  const handedOver = convos.filter((c) => c.status === "HANDOVER" || c.handoverReason).length;
  const qualified = convos.filter((c) => c.qualified).length;
  const frt = convos.map((c) => c.firstResponseMs).filter((v): v is number => v != null);
  const delivered = await db.message.count({ where: { tenantId, direction: "OUTBOUND", createdAt: { gte: since }, deliveredAt: { not: null } } });
  const outbound = await db.message.count({ where: { tenantId, direction: "OUTBOUND", createdAt: { gte: since } } });
  return {
    total,
    automatedRate: total ? (total - handedOver) / total : null,
    escalationRate: total ? handedOver / total : null,
    qualificationRate: total ? qualified / total : null,
    frtP50: percentile(frt, 50),
    frtP95: percentile(frt, 95),
    deliveryRate: outbound ? delivered / outbound : null,
  };
}

export const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
export const ms = (v: number | null) => (v == null ? "–" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
