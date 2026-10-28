import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { consumeState, exchangeCode } from "@/lib/auth/oidc";
import { createSession } from "@/lib/auth/session";
import { decryptForTenant } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/http";
import { log, errorFields } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const fail = (msg: string) => NextResponse.redirect(new URL("/login?error=" + encodeURIComponent(msg), req.url));
  const url = new URL(req.url);
  const state = await consumeState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (!state || !code) return fail("SSO session expired, please retry");

  const tenant = await db.tenant.findUnique({ where: { id: state.tenantId }, include: { ssoConfig: true } });
  if (!tenant?.ssoConfig) return fail("SSO is not configured");
  const sso = tenant.ssoConfig;
  try {
    const claims = await exchangeCode({
      issuer: sso.issuer,
      clientId: sso.clientId,
      clientSecret: decryptForTenant(tenant, sso.clientSecretEnc),
      redirectUri: `${env().APP_URL}/api/auth/sso/callback`,
      code,
      verifier: state.verifier,
      nonce: state.nonce,
    });
    const email = claims.email.toLowerCase();
    const domain = email.split("@")[1];
    if (sso.allowedDomains.length && !sso.allowedDomains.includes(domain)) return fail("Your email domain is not allowed for this organization");

    // Just-in-time provisioning with the tenant's default role.
    const user = await db.user.upsert({ where: { email }, create: { email, name: claims.name }, update: {} });
    if (user.disabled) return fail("Account disabled");
    await db.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      create: { userId: user.id, tenantId: tenant.id, role: sso.defaultRole },
      update: {},
    });
    await createSession(user, "sso");
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "auth.login", meta: { via: "sso" }, ip: clientIp(req) });
    return NextResponse.redirect(new URL(`/app/${tenant.id}`, req.url));
  } catch (err) {
    log.warn("sso.failed", { tenantId: tenant.id, ...errorFields(err) });
    return fail("SSO sign-in failed");
  }
}
