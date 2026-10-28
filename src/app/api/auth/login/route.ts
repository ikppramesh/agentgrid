import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/http";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const back = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url), 303);
  const form = Object.fromEntries(await req.formData());
  const parsed = schema.safeParse(form);
  if (!parsed.success) return back("Invalid email or password");
  const email = parsed.data.email.toLowerCase();
  const ip = clientIp(req);

  // Brute-force protection per account and per IP.
  const [a, b] = await Promise.all([rateLimit(`login:${email}`, 5, 300), rateLimit(`login-ip:${ip}`, 20, 300)]);
  if (!a.allowed || !b.allowed) return back("Too many attempts. Try again in a few minutes.");

  const user = await db.user.findUnique({ where: { email }, include: { memberships: { include: { tenant: { include: { ssoConfig: true } } } } } });
  // Constant-ish work whether or not the user exists.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !ok || user.disabled) {
    await audit({ action: "auth.login_failed", meta: { email }, ip });
    return back("Invalid email or password");
  }
  if (user.memberships.some((m) => m.tenant.ssoConfig?.enforced)) {
    return back("Your organization requires SSO sign-in.");
  }
  await createSession(user, "password");
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: user.id, action: "auth.login", meta: { via: "password" }, ip });
  return NextResponse.redirect(new URL("/app", req.url), 303);
}
