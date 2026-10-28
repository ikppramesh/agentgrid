import Link from "next/link";
import type { ConversationStatus } from "@prisma/client";
import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS: ConversationStatus[] = ["HANDOVER", "BOT", "RESOLVED"];

export default async function Conversations({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { tenantId } = await params;
  const { status } = await searchParams;
  await authorizePage(tenantId, "conversation:read");
  const filter = STATUS.includes(status as ConversationStatus) ? (status as ConversationStatus) : undefined;
  const convos = await db.conversation.findMany({
    where: { tenantId, ...(filter ? { status: filter } : {}) },
    include: { contact: true, agent: true, channel: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <>
      <h1>Conversations</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <Link href="?">All</Link>
        {STATUS.map((s) => <Link key={s} href={`?status=${s}`}>{s.toLowerCase()}</Link>)}
      </div>
      <table>
        <thead><tr><th>Contact</th><th>Agent / channel</th><th>Status</th><th>Last message</th><th>Updated</th></tr></thead>
        <tbody>
          {convos.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/app/${tenantId}/conversations/${c.id}`}>{c.contact.displayName ?? `Visitor ${c.contact.externalId.slice(-4)}`}</Link> {c.qualified && <span className="chip ok">qualified</span>}</td>
              <td>{c.agent.name}<div className="small muted">{c.channel.name}</div></td>
              <td><span className={`chip ${c.status === "HANDOVER" ? "warn" : c.status === "RESOLVED" ? "ok" : ""}`}>{c.status.toLowerCase()}</span>{c.handoverReason && <div className="small muted">{c.handoverReason}</div>}</td>
              <td className="small">{c.messages[0]?.text.slice(0, 80)}</td>
              <td className="small muted">{c.updatedAt.toLocaleString()}</td>
            </tr>
          ))}
          {!convos.length && <tr><td colSpan={5} className="muted">No conversations yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
