import Link from "next/link";
import { authorizePage } from "@/lib/auth/access";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const { tenant, role, session } = await authorizePage(tenantId, "tenant:read");
  const parent = tenant.parentId ? await db.tenant.findUnique({ where: { id: tenant.parentId } }) : null;
  // White-label: client workspaces inherit their agency's brand.
  const brand = {
    name: tenant.brandName ?? parent?.brandName ?? "AgentGrid",
    logo: tenant.brandLogoUrl ?? parent?.brandLogoUrl,
    color: tenant.brandColor ?? parent?.brandColor ?? "#4f46e5",
  };
  const base = `/app/${tenantId}`;
  return (
    <div className="shell" style={{ ["--brand" as string]: brand.color }}>
      <nav className="side">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brand.logo && <img src={brand.logo} alt="" />}
          {brand.name}
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>{tenant.name}{tenant.sandbox ? " · sandbox" : ""}</div>
        <Link href={base}>Overview</Link>
        <Link href={`${base}/conversations`}>Conversations</Link>
        {can(role, "agent:manage") && <Link href={`${base}/agents`}>Agents</Link>}
        {tenant.kind === "AGENCY" && can(role, "clients:manage") && <Link href={`${base}/clients`}>Clients</Link>}
        <Link href={`${base}/modelops`}>Model ops</Link>
        <Link href={`${base}/sla`}>SLA &amp; usage</Link>
        {can(role, "tenant:manage") && <Link href={`${base}/settings`}>Settings</Link>}
        {can(role, "audit:read") && <Link href={`${base}/audit`}>Audit log</Link>}
        <div className="foot">
          <div>{session.email}</div>
          <div>{role.toLowerCase()} · <Link href="/app">switch</Link></div>
          <form method="post" action="/api/auth/logout"><button className="ghost" style={{ padding: 0, border: 0 }}>Sign out</button></form>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
