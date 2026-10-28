import { checkHealth } from "@/lib/health";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness/readiness for uptime monitors. Exposes no tenant data. */
export async function GET() {
  const h = await checkHealth();
  return json({ status: h.ok ? "ok" : "degraded", db: h.dbOk, redis: h.redisOk }, h.ok ? 200 : 503);
}
