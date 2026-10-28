import Link from "next/link";
import { accessibleTenants, requireSession } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireSession();
  const { error } = await searchParams;
  const tenants = await accessibleTenants(session.userId);
  return (
    <main style={{ maxWidth: 800, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Workspaces</h1>
        <form method="post" action="/api/auth/logout"><button className="ghost">Sign out</button></form>
      </div>
      {error && <div className="alert">{error}</div>}
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Plan</th><th>Your role</th></tr></thead>
        <tbody>
          {tenants.map(({ tenant, role }) => (
            <tr key={tenant.id}>
              <td><Link href={`/app/${tenant.id}`}>{tenant.name}</Link> {tenant.sandbox && <span className="chip warn">sandbox</span>}</td>
              <td>{tenant.kind === "AGENCY" ? "Agency" : tenant.parentId ? "Client" : "Business"}</td>
              <td>{tenant.plan}</td>
              <td>{role}</td>
            </tr>
          ))}
          {!tenants.length && <tr><td colSpan={4} className="muted">No workspaces yet. Ask an admin to invite you.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
