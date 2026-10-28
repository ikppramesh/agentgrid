import { authorizePage } from "@/lib/auth/access";
import { tenantKpis, pct, ms } from "@/lib/kpis";
import { quota } from "@/lib/metering";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Overview({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const { tenant } = await authorizePage(tenantId, "tenant:read");
  const parent = tenant.parentId ? await db.tenant.findUnique({ where: { id: tenant.parentId } }) : null;
  const [k, q, waiting] = await Promise.all([
    tenantKpis(tenantId),
    quota(tenantId, parent?.plan ?? tenant.plan),
    db.conversation.count({ where: { tenantId, status: "HANDOVER" } }),
  ]);
  const tiles: { l: string; v: string; t: string }[] = [
    { l: "Conversations (30d)", v: String(k.total), t: "" },
    { l: "Automated resolution", v: pct(k.automatedRate), t: "target 60–90%" },
    { l: "Escalation to human", v: pct(k.escalationRate), t: "target 10–40%" },
    { l: "Leads qualified", v: pct(k.qualificationRate), t: "A/B to measure uplift" },
    { l: "First response p50", v: ms(k.frtP50), t: "target < 2 s" },
    { l: "First response p95", v: ms(k.frtP95), t: "" },
    { l: "Delivery success", v: pct(k.deliveryRate), t: "" },
    { l: "Waiting for a human", v: String(waiting), t: "" },
  ];
  return (
    <>
      <h1>Overview</h1>
      {tenant.sandbox && <div className="alert">Sandbox workspace: CRM updates, outbound webhooks and webhook channels are simulated, not sent.</div>}
      <div className="grid">
        {tiles.map((t) => (
          <div className="card kpi" key={t.l}>
            <div className="l">{t.l}</div>
            <div className="v">{t.v}</div>
            {t.t && <div className="t muted">{t.t}</div>}
          </div>
        ))}
      </div>
      <h2>Usage this month</h2>
      <div className="grid">
        <div className="card kpi"><div className="l">Messages</div><div className="v">{q.messagesUsed.toLocaleString()}</div><div className="t muted">of {q.messagesLimit.toLocaleString()}</div></div>
        <div className="card kpi"><div className="l">LLM tokens</div><div className="v">{q.tokensUsed.toLocaleString()}</div><div className="t muted">of {q.tokensLimit.toLocaleString()}</div></div>
      </div>
    </>
  );
}
