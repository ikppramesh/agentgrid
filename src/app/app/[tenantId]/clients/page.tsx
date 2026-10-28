import Link from "next/link";
import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { currentPeriod } from "@/lib/metering";
import { createClientAction, setClientFlagsAction } from "../actions";

export const dynamic = "force-dynamic";

/** Reseller dashboard: an agency manages and meters all its client workspaces. */
export default async function Clients({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const { tenant } = await authorizePage(tenantId, "clients:manage");
  if (tenant.kind !== "AGENCY") return <p>Only agency workspaces have clients.</p>;
  const clients = await db.tenant.findMany({
    where: { parentId: tenantId },
    include: { usage: { where: { period: currentPeriod() } }, _count: { select: { agents: true, conversations: true } } },
    orderBy: { createdAt: "asc" },
  });
  const totals = clients.reduce(
    (t, c) => ({ msgs: t.msgs + (c.usage[0]?.messagesIn ?? 0) + (c.usage[0]?.messagesOut ?? 0), tokens: t.tokens + (c.usage[0]?.llmInputTokens ?? 0) + (c.usage[0]?.llmOutputTokens ?? 0) }),
    { msgs: 0, tokens: 0 },
  );
  return (
    <>
      <h1>Clients</h1>
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="l">Client workspaces</div><div className="v">{clients.length}</div></div>
        <div className="card kpi"><div className="l">Messages this month</div><div className="v">{totals.msgs.toLocaleString()}</div></div>
        <div className="card kpi"><div className="l">LLM tokens this month</div><div className="v">{totals.tokens.toLocaleString()}</div></div>
      </div>
      <table>
        <thead><tr><th>Client</th><th>Agents</th><th>Conversations</th><th>Messages (mo)</th><th>Tokens (mo)</th><th>Flags</th><th></th></tr></thead>
        <tbody>
          {clients.map((c) => {
            const u = c.usage[0];
            return (
              <tr key={c.id}>
                <td><Link href={`/app/${c.id}`}>{c.name}</Link><div className="small muted">{c.slug}</div></td>
                <td>{c._count.agents}</td>
                <td>{c._count.conversations}</td>
                <td>{((u?.messagesIn ?? 0) + (u?.messagesOut ?? 0)).toLocaleString()}</td>
                <td>{((u?.llmInputTokens ?? 0) + (u?.llmOutputTokens ?? 0)).toLocaleString()}</td>
                <td>{c.sandbox && <span className="chip warn">sandbox</span>} {c.suspended && <span className="chip bad">suspended</span>}</td>
                <td className="row">
                  <form action={setClientFlagsAction.bind(null, tenantId, c.id, { sandbox: !c.sandbox })}><button className="ghost">{c.sandbox ? "Go live" : "Sandbox"}</button></form>
                  <form action={setClientFlagsAction.bind(null, tenantId, c.id, { suspended: !c.suspended })}><button className={c.suspended ? "ghost" : "danger"}>{c.suspended ? "Resume" : "Suspend"}</button></form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>New client workspace</h2>
      <div className="card">
        <form className="stack" action={createClientAction.bind(null, tenantId)}>
          <label>Client name<input name="name" required /></label>
          <label className="row"><input type="checkbox" name="sandbox" defaultChecked /> Start in sandbox (no real CRM/outbound calls)</label>
          <button>Create client</button>
        </form>
      </div>
    </>
  );
}
