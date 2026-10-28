import { redis } from "./redis";
import { randomToken } from "./crypto";

/**
 * One-time secret display (webhook secrets, temporary passwords) without
 * putting secrets in URLs / browser history / access logs. Ticket expires in 5 min
 * and is bound to the tenant that created it.
 */
export async function createReveal(tenantId: string, data: Record<string, string>) {
  const ticket = randomToken(16);
  await redis().set(`reveal:${ticket}`, JSON.stringify({ tenantId, data }), "EX", 300);
  return ticket;
}

export async function consumeReveal(tenantId: string, ticket?: string): Promise<Record<string, string> | null> {
  if (!ticket) return null;
  const key = `reveal:${ticket}`;
  const raw = await redis().get(key);
  if (!raw) return null;
  await redis().del(key);
  const parsed = JSON.parse(raw) as { tenantId: string; data: Record<string, string> };
  return parsed.tenantId === tenantId ? parsed.data : null;
}
