import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildAuthUrl } from "@/lib/auth/oidc";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/** Start OIDC SSO for an organization: /api/auth/sso/start?org=<tenant-slug> */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("org") ?? "";
  const tenant = await db.tenant.findUnique({ where: { slug }, include: { ssoConfig: true } });
  if (!tenant?.ssoConfig) {
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("SSO is not configured for that organization"), req.url));
  }
  const url = await buildAuthUrl({
    issuer: tenant.ssoConfig.issuer,
    clientId: tenant.ssoConfig.clientId,
    redirectUri: `${env().APP_URL}/api/auth/sso/callback`,
    tenantId: tenant.id,
  });
  return NextResponse.redirect(url);
}
