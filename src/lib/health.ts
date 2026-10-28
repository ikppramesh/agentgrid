import { db } from "./db";
import { redis } from "./redis";
import { stats } from "./queue/queue";

export async function checkHealth() {
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const t1 = Date.now();
  let redisOk = true;
  try {
    await redis().ping();
  } catch {
    redisOk = false;
  }
  const t2 = Date.now();
  const queue = redisOk ? await stats() : { ready: -1, processing: -1, delayed: -1, dead: -1 };
  return { ok: dbOk && redisOk, dbOk, redisOk, dbMs: t1 - t0, redisMs: t2 - t1, queue };
}
