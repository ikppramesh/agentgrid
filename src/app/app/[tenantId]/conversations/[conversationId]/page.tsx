import { notFound } from "next/navigation";
import { authorizePage } from "@/lib/auth/access";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { decryptForTenant, decryptJson } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { replyAction, setStatusAction, labelIntentAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ tenantId: string; conversationId: string }> }) {
  const { tenantId, conversationId } = await params;
  const { tenant, role, session } = await authorizePage(tenantId, "conversation:read");
  const convo = await db.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { contact: true, agent: true, channel: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!convo) notFound();
  const showPii = can(role, "pii:read");
  const canReply = can(role, "conversation:reply");
  if (showPii) await audit({ tenantId, actorId: session.userId, action: "pii.view", target: convo.id });
  const profile = showPii && convo.contact.profileEnc ? decryptJson<Record<string, string>>(tenant, convo.contact.profileEnc) : null;
  const state = convo.state as { slots?: Record<string, string>; step?: string };

  return (
    <>
      <h1>{convo.contact.displayName ?? "Visitor"} <span className="chip">{convo.status.toLowerCase()}</span></h1>
      <div className="split">
        <div className="card">
          <div className="transcript">
            {convo.messages.map((m) => {
              const text = showPii && m.textEnc ? decryptForTenant(tenant, m.textEnc) : m.text;
              const cls = m.sender === "CONTACT" ? "msg" : m.sender === "HUMAN" ? "msg human" : "msg out";
              return (
                <div key={m.id} className={cls}>
                  <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
                  <div className="meta">
                    {m.sender.toLowerCase()} · {m.createdAt.toLocaleTimeString()}
                    {m.intent && ` · ${m.intent} (${(m.confidence ?? 0).toFixed(2)})`}
                    {m.labeledIntent && ` → ${m.labeledIntent}`}
                    {m.model && ` · ${m.model}/${m.promptVersion}`}
                    {m.guardrailFlags.length > 0 && ` · ⚑ ${m.guardrailFlags.join(",")}`}
                    {m.direction === "OUTBOUND" && !m.deliveredAt && convo.channel.type !== "WEBCHAT" && " · pending"}
                  </div>
                  {canReply && m.sender === "CONTACT" && (
                    <form action={labelIntentAction.bind(null, tenantId, m.id)} className="row" style={{ marginTop: 4 }}>
                      <input name="label" placeholder="correct intent" style={{ padding: "2px 6px", fontSize: 11, width: 120 }} />
                      <button className="ghost" style={{ padding: "2px 6px", fontSize: 11, color: "inherit", borderColor: "currentColor" }}>label</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          {canReply && (
            <form action={replyAction.bind(null, tenantId, convo.id)} className="row" style={{ marginTop: 16 }}>
              <input name="text" placeholder="Reply as a human agent (takes over from the bot)…" style={{ flex: 1 }} required />
              <button>Send</button>
            </form>
          )}
        </div>
        <div>
          <div className="card">
            <h3>Context</h3>
            <div className="small">Agent: {convo.agent.name}<br />Channel: {convo.channel.name}<br />Stage: {state.step ?? "–"}<br />Handover reason: {convo.handoverReason ?? "–"}</div>
            <h3 style={{ marginTop: 12 }}>Captured details</h3>
            {profile ? (
              <pre>{JSON.stringify(profile, null, 2)}</pre>
            ) : (
              <div className="small muted">{Object.keys(state.slots ?? {}).join(", ") || "none"} {!showPii && "(hidden – requires pii:read)"}</div>
            )}
            {canReply && (
              <div className="row" style={{ marginTop: 12 }}>
                {convo.status !== "HANDOVER" && <form action={setStatusAction.bind(null, tenantId, convo.id, "HANDOVER")}><button className="ghost">Take over</button></form>}
                {convo.status !== "BOT" && <form action={setStatusAction.bind(null, tenantId, convo.id, "BOT")}><button className="ghost">Return to bot</button></form>}
                {convo.status !== "RESOLVED" && <form action={setStatusAction.bind(null, tenantId, convo.id, "RESOLVED")}><button>Resolve</button></form>}
              </div>
            )}
          </div>
          {showPii && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Privacy</h3>
              <div className="small">Consent: {convo.contact.consentAt ? `${convo.contact.consentText} @ ${convo.contact.consentAt.toLocaleString()}` : "–"}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <a className="btn" href={`/api/privacy/${tenantId}/contacts/${convo.contactId}`}>Export data (DSAR)</a>
              </div>
              <p className="small muted">Erasure: <code>DELETE /api/privacy/{tenantId}/contacts/{convo.contactId}</code> or the customer sends “delete my data”.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
