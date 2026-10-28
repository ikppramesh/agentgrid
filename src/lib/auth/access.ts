import type { Role, Tenant } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "../db";
import { can, type Permission } from "./rbac";
import { readSession, type Session } from "./session";
import { HttpError } from "../http";

export interface TenantContext {
  session: Session;
  tenant: Tenant;
  role: Role;
}

/**
 * Resolve the caller's effective role on a tenant. Direct membership wins;
 * otherwise agency members inherit their role on the agency's client tenants.
 */
export async function effectiveRole(userId: string, tenant: Pick<Tenant, "id" | "parentId">): Promise<Role | null> {
  const direct = await db.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: tenant.id } } });
  if (direct) return direct.role;
  if (tenant.parentId) {
    const viaAgency = await db.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId: tenant.parentId } },
    });
    if (viaAgency) return viaAgency.role;
  }
  return null;
}

/** Authorize a tenant-scoped action. Throws 401/403/404 – use in API routes and server actions. */
export async function authorize(tenantId: string, permission: Permission): Promise<TenantContext> {
  const session = await readSession();
  if (!session) throw new HttpError(401, "Not signed in");
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new HttpError(404, "Not found");
  const role = await effectiveRole(session.userId, tenant);
  // Same 404 for "exists but not yours" to avoid tenant enumeration.
  if (!role) throw new HttpError(404, "Not found");
  if (!can(role, permission)) throw new HttpError(403, "Forbidden");
  if (tenant.suspended && permission !== "tenant:read") throw new HttpError(403, "Tenant suspended");
  return { session, tenant, role };
}

/** Page variant: redirects instead of throwing. */
export async function authorizePage(tenantId: string, permission: Permission): Promise<TenantContext> {
  try {
    return await authorize(tenantId, permission);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) redirect("/login");
    if (err instanceof HttpError) redirect("/app?error=" + encodeURIComponent(err.message));
    throw err;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await readSession();
  if (!s) redirect("/login");
  return s;
}

/** Tenants a user can reach (direct + agency clients). */
export async function accessibleTenants(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { tenant: { include: { clients: true } } },
  });
  const out = new Map<string, { tenant: Tenant; role: Role }>();
  for (const m of memberships) {
    out.set(m.tenant.id, { tenant: m.tenant, role: m.role });
    for (const c of m.tenant.clients) if (!out.has(c.id)) out.set(c.id, { tenant: c, role: m.role });
  }
  return [...out.values()];
}
