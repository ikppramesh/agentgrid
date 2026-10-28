import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Model ops: NLU quality & drift, guardrail incidents, prompt/model versions, cost. */
export default async function ModelOps({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await authorizePage(tenantId, "conversation:read");
  const since = new Date(Date.now() - 14 * 86_400_000);
  const inbound = await db.message.findMany({
    where: { tenantId, direction: "INBOUND", createdAt: { gte: since } },
    select: { intent: true, confidence: true, labeledIntent: true, createdAt: true },
  });
  const generated = await db.message.findMany({
    where: { tenantId, sender: "BOT", createdAt: { gte: since }, promptVersion: { not: null } },
    select: { model: true, promptVersion: true, latencyMs: true, inputTokens: true, outputTokens: true, guardrailFlags: true },
  });

  // Drift: daily share of low-confidence / unknown intents.
  const byDay = new Map<string, { n: number; low: number }>();
  for (const m of inbound) {
    const d = m.createdAt.toISOString().slice(0, 10);
    const e = byDay.get(d) ?? { n: 0, low: 0 };
    e.n++;
    if ((m.confidence ?? 0) < 0.5 || m.intent === "unknown") e.low++;
    byDay.set(d, e);
  }
  const labeled = inbound.filter((m) => m.labeledIntent);
  const nluAccuracy = labeled.length ? labeled.filter((m) => m.labeledIntent === m.intent).length / labeled.length : null;

  const intents = new Map<string, number>();
  for (const m of inbound) intents.set(m.intent ?? "?", (intents.get(m.intent ?? "?") ?? 0) + 1);

  const versions = new Map<string, { n: number; lat: number; tin: number; tout: number }>();
  const flags = new Map<string, number>();
  for (const g of generated) {
    const key = `${g.model ?? "retrieval"} · ${g.promptVersion}`;
    const v = versions.get(key) ?? { n: 0, lat: 0, tin: 0, tout: 0 };
    v.n++;
    v.lat += g.latencyMs ?? 0;
    v.tin += g.inputTokens ?? 0;
    v.tout += g.outputTokens ?? 0;
    versions.set(key, v);
    for (const f of g.guardrailFlags) flags.set(f, (flags.get(f) ?? 0) + 1);
  }

  return (
    <>
      <h1>Model ops <span className="small muted">last 14 days</span></h1>
      <div className="grid">
        <div className="card kpi"><div className="l">Inbound messages</div><div className="v">{inbound.length}</div></div>
        <div className="card kpi"><div className="l">Human-labeled</div><div className="v">{labeled.length}</div></div>
        <div className="card kpi"><div className="l">NLU accuracy vs labels</div><div className="v">{nluAccuracy == null ? "–" : `${(nluAccuracy * 100).toFixed(1)}%`}</div></div>
        <div className="card kpi"><div className="l">Generated answers</div><div className="v">{generated.length}</div></div>
      </div>
      <div className="split">
        <div>
          <h2>Low-confidence rate by day (drift)</h2>
          <table><tbody>
            {[...byDay.entries()].sort().map(([d, e]) => <tr key={d}><td>{d}</td><td>{e.n}</td><td>{((e.low / e.n) * 100).toFixed(0)}%</td></tr>)}
          </tbody></table>
          <h2>Intent distribution</h2>
          <table><tbody>{[...intents.entries()].sort((a, b) => b[1] - a[1]).map(([i, n]) => <tr key={i}><td>{i}</td><td>{n}</td></tr>)}</tbody></table>
        </div>
        <div>
          <h2>Model / prompt versions</h2>
          <table>
            <thead><tr><th>Version</th><th>Answers</th><th>Avg latency</th><th>Avg tokens in/out</th></tr></thead>
            <tbody>{[...versions.entries()].map(([k, v]) => <tr key={k}><td className="small">{k}</td><td>{v.n}</td><td>{Math.round(v.lat / v.n)} ms</td><td>{Math.round(v.tin / v.n)} / {Math.round(v.tout / v.n)}</td></tr>)}</tbody>
          </table>
          <h2>Guardrail events</h2>
          <table><tbody>
            {[...flags.entries()].map(([f, n]) => <tr key={f}><td>{f}</td><td>{n}</td></tr>)}
            {!flags.size && <tr><td className="muted">No guardrail events.</td></tr>}
          </tbody></table>
          <p className="small muted">Offline evaluation: <code>npm run eval</code> · training/eval dataset: <code>npm run dataset:export</code> (PII-redacted, uses human labels).</p>
        </div>
      </div>
    </>
  );
}
