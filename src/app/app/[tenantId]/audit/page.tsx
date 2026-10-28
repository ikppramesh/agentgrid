import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Audit({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await authorizePage(tenantId, "audit:read");
  const logs = await db.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 });
  const actors = await db.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.actorId ?? ""))] } }, select: { id: true, email: true } });
  const email = new Map(actors.map((a) => [a.id, a.email]));
  return (
    <>
      <h1>Audit log</h1>
      <table>
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="small">{l.createdAt.toLocaleString()}</td>
              <td className="small">{email.get(l.actorId ?? "") ?? l.actorId}</td>
              <td><code>{l.action}</code></td>
              <td className="small muted">{l.target}</td>
              <td className="small">{JSON.stringify(l.meta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
