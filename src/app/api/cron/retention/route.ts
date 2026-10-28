import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { handleError, json, requireCron } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Daily data-retention enforcement per tenant policy (GDPR storage limitation). */
export async function GET(req: Request) {
  try {
    requireCron(req);
    const tenants = await db.tenant.findMany({ select: { id: true, retentionDays: true } });
    let messages = 0;
    let conversations = 0;
    for (const t of tenants) {
      const cutoff = new Date(Date.now() - t.retentionDays * 86_400_000);
      messages += (await db.message.deleteMany({ where: { tenantId: t.id, createdAt: { lt: cutoff } } })).count;
      conversations += (
        await db.conversation.deleteMany({ where: { tenantId: t.id, updatedAt: { lt: cutoff }, messages: { none: {} } } })
      ).count;
    }
    // Operational probes are kept 90 days, audit logs 400 days.
    await db.slaProbe.deleteMany({ where: { at: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
    await db.auditLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 400 * 86_400_000) } } });
    await audit({ action: "retention.run", meta: { messages, conversations } });
    return json({ deleted: { messages, conversations } });
  } catch (err) {
    return handleError(err);
  }
}
