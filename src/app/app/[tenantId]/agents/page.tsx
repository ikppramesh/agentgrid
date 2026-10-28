import Link from "next/link";
import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { TEMPLATES } from "@/core/templates";
import { planFor } from "@/lib/plans";
import { createAgentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Agents({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const { tenant } = await authorizePage(tenantId, "agent:manage");
  const agents = await db.agent.findMany({ where: { tenantId }, include: { _count: { select: { conversations: true, channels: true } } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <h1>Agents</h1>
      <table>
        <thead><tr><th>Name</th><th>Template</th><th>Channels</th><th>Conversations</th><th>Status</th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/app/${tenantId}/agents/${a.id}`}>{a.name}</Link></td>
              <td>{TEMPLATES.find((t) => t.id === a.templateId)?.name}</td>
              <td>{a._count.channels}</td>
              <td>{a._count.conversations}</td>
              <td><span className={`chip ${a.active ? "ok" : "bad"}`}>{a.active ? "active" : "paused"}</span></td>
            </tr>
          ))}
          {!agents.length && <tr><td colSpan={5} className="muted">No agents yet – start from a template below.</td></tr>}
        </tbody>
      </table>
      <h2>New agent from template <span className="small muted">({agents.length}/{planFor(tenant.plan).maxAgents} on {tenant.plan})</span></h2>
      <div className="grid">
        {TEMPLATES.map((t) => (
          <form key={t.id} className="card" action={createAgentAction.bind(null, tenantId)}>
            <input type="hidden" name="templateId" value={t.id} />
            <h3>{t.name}</h3>
            <div className="small muted">{t.industry}{t.restricted && " · restricted mode"}</div>
            <p className="small">{t.description}</p>
            <input name="name" placeholder="Agent name (optional)" style={{ width: "100%", marginBottom: 8 }} />
            <button>Create</button>
          </form>
        ))}
      </div>
    </>
  );
}
