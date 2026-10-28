import { notFound } from "next/navigation";
import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getTemplate } from "@/core/templates";
import { consumeReveal } from "@/lib/reveal";
import {
  updateAgentAction,
  addKnowledgeAction,
  deleteKnowledgeAction,
  connectTelegramAction,
  createWebhookChannelAction,
  toggleChannelAction,
} from "../../actions";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params, searchParams }: { params: Promise<{ tenantId: string; agentId: string }>; searchParams: Promise<{ reveal?: string }> }) {
  const { tenantId, agentId } = await params;
  const { reveal } = await searchParams;
  await authorizePage(tenantId, "agent:manage");
  const agent = await db.agent.findFirst({ where: { id: agentId, tenantId }, include: { channels: { orderBy: { createdAt: "asc" } } } });
  if (!agent) notFound();
  const template = getTemplate(agent.templateId);
  const knowledge = await db.knowledgeItem.findMany({ where: { tenantId, agentId }, orderBy: { updatedAt: "desc" } });
  const cfg = (agent.config ?? {}) as Record<string, string>;
  const revealed = await consumeReveal(tenantId, reveal);
  const appUrl = env().APP_URL;

  return (
    <>
      <h1>{agent.name}</h1>
      <p className="muted">{template.name} · slots: {template.slots.map((s) => s.name).join(", ")}{template.restricted && " · restricted (no improvised answers)"}</p>

      {revealed && (
        <div className="alert success">
          Webhook channel created. Copy the signing secret now – it will not be shown again:
          <pre>{revealed.secret}</pre>
          Inbound URL: <code>{appUrl}/api/channels/webhook/{revealed.channelId}</code>
        </div>
      )}

      <div className="split">
        <div className="card">
          <h3>Configuration</h3>
          <form className="stack" action={updateAgentAction.bind(null, tenantId, agentId)}>
            <label>Name<input name="name" defaultValue={agent.name} required /></label>
            <label>Persona / business context (sent to the LLM)<textarea name="persona" defaultValue={agent.persona} placeholder="We are Skyline Realty, selling 2–4 BHK apartments in Whitefield and Sarjapur…" /></label>
            <label>Greeting<input name="greeting" defaultValue={agent.greeting ?? ""} placeholder={template.greeting} /></label>
            <label>Handover confidence threshold (0–1)<input name="handoverThreshold" type="number" step="0.05" min="0" max="1" defaultValue={agent.handoverThreshold} /></label>
            <label>Booking link (Calendly, Cal.com…)<input name="bookingLink" type="url" defaultValue={cfg.bookingLink ?? ""} /></label>
            <label>Payment link (Razorpay / Stripe payment link)<input name="paymentLink" type="url" defaultValue={cfg.paymentLink ?? ""} /></label>
            <label className="row"><input type="checkbox" name="active" defaultChecked={agent.active} /> Active</label>
            <button>Save</button>
          </form>
        </div>

        <div>
          <div className="card">
            <h3>Channels</h3>
            <table>
              <tbody>
                {agent.channels.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}<div className="small muted">{c.type.toLowerCase()} · {c.id}</div></td>
                    <td>
                      <form action={toggleChannelAction.bind(null, tenantId, agentId, c.id, !c.active)}>
                        <button className="ghost">{c.active ? "Disable" : "Enable"}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {agent.channels.filter((c) => c.type === "WEBCHAT").map((c) => (
              <div key={c.id} style={{ marginTop: 12 }}>
                <div className="small">Website embed:</div>
                <pre>{`<script src="${appUrl}/widget.js" data-channel="${c.id}" async></script>`}</pre>
                <a href={`/widget/${c.id}`} target="_blank">Open test chat ↗</a>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>Connect Telegram bot</h3>
            <form className="stack" action={connectTelegramAction.bind(null, tenantId, agentId)}>
              <label>Bot token from @BotFather<input name="botToken" placeholder="123456:ABC-…" required autoComplete="off" /></label>
              <button>Connect &amp; register webhook</button>
            </form>
            <p className="small muted">Token is encrypted with this workspace&apos;s key. Webhook calls are verified with a per-channel secret.</p>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>Webhook channel (WhatsApp / Messenger / SMS bridge)</h3>
            <form className="stack" action={createWebhookChannelAction.bind(null, tenantId, agentId)}>
              <label>Name<input name="name" placeholder="WhatsApp bridge" /></label>
              <label>Outbound URL (we POST replies here, HMAC-signed)<input name="outboundUrl" type="url" placeholder="https://your-bridge.example.com/agentgrid" required /></label>
              <button>Create</button>
            </form>
          </div>
        </div>
      </div>

      <h2>Knowledge ({knowledge.length})</h2>
      <div className="split">
        <table>
          <tbody>
            {knowledge.map((k) => (
              <tr key={k.id}>
                <td><strong>{k.title}</strong><div className="small">{k.content}</div><div className="small muted">{k.tags.join(", ")}</div></td>
                <td><form action={deleteKnowledgeAction.bind(null, tenantId, agentId, k.id)}><button className="ghost">Delete</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card">
          <form className="stack" action={addKnowledgeAction.bind(null, tenantId, agentId)}>
            <label>Title<input name="title" required /></label>
            <label>Content<textarea name="content" required /></label>
            <label>Tags (comma separated)<input name="tags" /></label>
            <button>Add knowledge</button>
          </form>
        </div>
      </div>
    </>
  );
}
