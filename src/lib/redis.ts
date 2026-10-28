import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/**
 * Shared Redis connection. Works with Vercel Redis / Upstash (rediss:// TCP URL)
 * and local redis. Serverless-friendly: lazy connect, bounded retries.
 */
export function redis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return globalForRedis.redis;
}

/** Test hook: inject a mock client. */
export function setRedis(client: Redis) {
  globalForRedis.redis = client;
}
