import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { redis } from "../redis";
import { randomToken } from "../crypto";

export const SESSION_COOKIE = "ag_session";
const SESSION_TTL_SEC = 8 * 60 * 60;

export interface Session {
  sid: string;
  userId: string;
  email: string;
  via: "password" | "sso";
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET not configured");
  return new TextEncoder().encode(s);
}

/**
 * Sessions are short-lived signed JWTs whose `sid` must also exist in Redis,
 * so logout / user disable / admin revocation take effect immediately.
 */
export async function createSession(user: { id: string; email: string }, via: Session["via"]) {
  const sid = randomToken(18);
  await redis().set(`session:${sid}`, user.id, "EX", SESSION_TTL_SEC);
  await redis().sadd(`user_sessions:${user.id}`, sid);
  const token = await new SignJWT({ uid: user.id, email: user.email, via })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(sid)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const sid = payload.jti;
    if (!sid || (await redis().get(`session:${sid}`)) !== payload.uid) return null;
    return { sid, userId: String(payload.uid), email: String(payload.email), via: payload.via as Session["via"] };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const s = await readSession();
  if (s) {
    await redis().del(`session:${s.sid}`);
    await redis().srem(`user_sessions:${s.userId}`, s.sid);
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/** Revoke every active session for a user (offboarding / compromise). */
export async function revokeUserSessions(userId: string) {
  const sids = await redis().smembers(`user_sessions:${userId}`);
  if (sids.length) await redis().del(...sids.map((s) => `session:${s}`));
  await redis().del(`user_sessions:${userId}`);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
