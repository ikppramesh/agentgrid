import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { planFor } from "@/lib/plans";
import { tenantKpis, pct, ms } from "@/lib/kpis";
import { deadLetters, stats } from "@/lib/queue/queue";
import { currentPeriod } from "@/lib/metering";
import { replayDeadLetterAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Sla({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const { tenant } = await authorizePage(tenantId, "billing:read");
  const parent = tenant.parentId ? await db.tenant.findUnique({ where: { id: tenant.parentId } }) : null;
  const plan = planFor(parent?.plan ?? tenant.plan);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [probes, okProbes, k, q, dead, usage] = await Promise.all([
    db.slaProbe.count({ where: { at: { gte: since } } }),
    db.slaProbe.count({ where: { at: { gte: since }, ok: true } }),
    tenantKpis(tenantId),
    stats(),
    deadLetters(tenantId, 20),
    db.usageRecord.findMany({ where: { tenantId }, orderBy: { period: "desc" }, take: 6 }),
  ]);
  const uptime = probes ? okProbes / probes : null;
  const rows = [
    { m: "Platform availability (30d)", target: `${plan.sla.uptimeTarget}%`, actual: pct(uptime), ok: uptime == null || uptime * 100 >= plan.sla.uptimeTarget },
    { m: "First response p95", target: ms(plan.sla.firstResponseP95Ms), actual: ms(k.frtP95), ok: k.frtP95 == null || k.frtP95 <= plan.sla.firstResponseP95Ms },
    { m: "Outbound delivery success", target: `${plan.sla.deliverySuccessTarget}%`, actual: pct(k.deliveryRate), ok: k.deliveryRate == null || k.deliveryRate * 100 >= plan.sla.deliverySuccessTarget },
    { m: "Support first response", target: `${plan.sla.supportResponseHours} h`, actual: "tracked in helpdesk", ok: true },
  ];
  return (
    <>
      <h1>SLA &amp; usage <span className="chip">{plan.name}</span></h1>
      <table>
        <thead><tr><th>Objective</th><th>Target</th><th>Actual</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.m}><td>{r.m}</td><td>{r.target}</td><td>{r.actual}</td><td><span className={`chip ${r.ok ? "ok" : "bad"}`}>{r.ok ? "met" : "breach"}</span></td></tr>)}
        </tbody>
      </table>
      <p className="small muted">Availability comes from 5-minute synthetic probes ({probes} in the last 30 days). Credits for breaches are defined in docs/SLA.md.</p>

      <h2>Metered usage (billing)</h2>
      <table>
        <thead><tr><th>Period</th><th>Msgs in</th><th>Msgs out</th><th>Conversations</th><th>LLM calls</th><th>LLM tokens</th><th>Workflow runs</th></tr></thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.id}>
              <td>{u.period}{u.period === currentPeriod() && " (current)"}</td><td>{u.messagesIn}</td><td>{u.messagesOut}</td><td>{u.conversations}</td>
              <td>{u.llmCalls}</td><td>{(u.llmInputTokens + u.llmOutputTokens).toLocaleString()}</td><td>{u.workflowRuns}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Queue</h2>
      <div className="grid">
        {Object.entries(q).map(([key, n]) => <div className="card kpi" key={key}><div className="l">{key} (platform)</div><div className="v">{n}</div></div>)}
      </div>
      <h3 style={{ marginTop: 16 }}>Dead letters for this workspace</h3>
      <table>
        <tbody>
          {dead.map((j) => (
            <tr key={j.id}>
              <td>{j.type}<div className="small muted">{new Date(j.createdAt).toLocaleString()} · {j.attempts} attempts</div></td>
              <td className="small">{j.lastError}</td>
              <td><form action={replayDeadLetterAction.bind(null, tenantId, j.id)}><button className="ghost">Replay</button></form></td>
            </tr>
          ))}
          {!dead.length && <tr><td className="muted">None 🎉</td></tr>}
        </tbody>
      </table>
    </>
  );
}
