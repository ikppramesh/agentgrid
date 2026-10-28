import { redis } from "./redis";

/** Fixed-window rate limiter in Redis. Returns remaining budget. */
export async function rateLimit(key: string, limit: number, windowSec = 60) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const r = redis();
  const count = await r.incr(k);
  if (count === 1) await r.expire(k, windowSec + 1);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
