import { randomUUID } from "node:crypto";
import { redis } from "../redis";

/**
 * Reliable job queue on Redis (works on Vercel Redis / Upstash / local Redis).
 *
 *   enqueue ─► q:ready ──claim(LMOVE)──► q:processing (+ lease in q:leases)
 *                ▲                           │ ack → removed
 *                │  promote (due)            │ fail → q:delayed (exp. backoff) or q:dead
 *             q:delayed ◄────────────────────┘ lease expired (crash) → back to q:ready
 *
 * - Idempotency keys de-duplicate webhook redeliveries (Telegram/WhatsApp retry on non-2xx).
 * - At-least-once delivery; handlers must be idempotent (they are keyed by message id).
 */
export const K = {
  jobs: "q:jobs",
  ready: "q:ready",
  processing: "q:processing",
  leases: "q:leases",
  delayed: "q:delayed",
  dead: "q:dead",
  idem: (key: string) => `q:idem:${key}`,
};

export interface Job<P = unknown> {
  id: string;
  type: string;
  tenantId: string;
  payload: P;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastError?: string;
}

export interface EnqueueOptions {
  idempotencyKey?: string;
  delayMs?: number;
  maxAttempts?: number;
}

const LEASE_MS = 60_000;
const IDEM_TTL_SEC = 24 * 3600;

export async function enqueue<P>(type: string, tenantId: string, payload: P, opts: EnqueueOptions = {}) {
  const r = redis();
  if (opts.idempotencyKey) {
    const fresh = await r.set(K.idem(opts.idempotencyKey), "1", "EX", IDEM_TTL_SEC, "NX");
    if (!fresh) return { enqueued: false as const, duplicate: true };
  }
  const job: Job<P> = {
    id: randomUUID(),
    type,
    tenantId,
    payload,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? Number(process.env.QUEUE_MAX_ATTEMPTS ?? 5),
    createdAt: Date.now(),
  };
  await r.hset(K.jobs, job.id, JSON.stringify(job));
  if (opts.delayMs && opts.delayMs > 0) await r.zadd(K.delayed, Date.now() + opts.delayMs, job.id);
  else await r.lpush(K.ready, job.id);
  return { enqueued: true as const, id: job.id };
}

export async function claim(): Promise<Job | null> {
  const r = redis();
  const id = await r.lmove(K.ready, K.processing, "RIGHT", "LEFT");
  if (!id) return null;
  await r.zadd(K.leases, Date.now() + LEASE_MS, id);
  const raw = await r.hget(K.jobs, id);
  if (!raw) {
    await ack(id);
    return null;
  }
  return JSON.parse(raw) as Job;
}

export async function ack(id: string) {
  const r = redis();
  await r.lrem(K.processing, 1, id);
  await r.zrem(K.leases, id);
  await r.hdel(K.jobs, id);
}

export function backoffMs(attempt: number) {
  // 2s, 4s, 8s, 16s … capped at 5 min, with ±20% jitter.
  const base = Math.min(2000 * 2 ** (attempt - 1), 300_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export async function fail(job: Job, error: string) {
  const r = redis();
  job.attempts += 1;
  job.lastError = error.slice(0, 500);
  await r.hset(K.jobs, job.id, JSON.stringify(job));
  await r.lrem(K.processing, 1, job.id);
  await r.zrem(K.leases, job.id);
  if (job.attempts >= job.maxAttempts) {
    await r.lpush(K.dead, job.id);
    return "dead" as const;
  }
  await r.zadd(K.delayed, Date.now() + backoffMs(job.attempts), job.id);
  return "retry" as const;
}

/** Put a job back without counting an attempt (e.g. conversation lock held). */
export async function defer(job: Job, delayMs: number) {
  const r = redis();
  await r.lrem(K.processing, 1, job.id);
  await r.zrem(K.leases, job.id);
  await r.zadd(K.delayed, Date.now() + delayMs, job.id);
}

/** Move due delayed jobs to ready. ZREM is atomic, so concurrent workers never double-promote. */
export async function promoteDue(now = Date.now()) {
  const r = redis();
  const ids = await r.zrangebyscore(K.delayed, "-inf", now, "LIMIT", 0, 200);
  let n = 0;
  for (const id of ids) {
    if ((await r.zrem(K.delayed, id)) === 1) {
      await r.lpush(K.ready, id);
      n++;
    }
  }
  return n;
}

/** Recover jobs whose worker died mid-flight (serverless timeout, crash). */
export async function reclaimExpired(now = Date.now()) {
  const r = redis();
  let n = 0;
  for (const id of await r.zrangebyscore(K.leases, "-inf", now, "LIMIT", 0, 200)) {
    if ((await r.zrem(K.leases, id)) === 1) {
      await r.lrem(K.processing, 1, id);
      await r.lpush(K.ready, id);
      n++;
    }
  }
  // Items moved to processing whose lease write never happened get a grace lease.
  for (const id of await r.lrange(K.processing, 0, 200)) {
    if ((await r.zscore(K.leases, id)) === null) await r.zadd(K.leases, now + LEASE_MS, id);
  }
  return n;
}

export async function stats() {
  const r = redis();
  const [ready, processing, delayed, dead] = await Promise.all([
    r.llen(K.ready),
    r.llen(K.processing),
    r.zcard(K.delayed),
    r.llen(K.dead),
  ]);
  return { ready, processing, delayed, dead };
}

export async function getJob(id: string): Promise<Job | null> {
  const raw = await redis().hget(K.jobs, id);
  return raw ? (JSON.parse(raw) as Job) : null;
}

export async function deadLetters(tenantId?: string, limit = 50): Promise<Job[]> {
  const ids = await redis().lrange(K.dead, 0, 499);
  const out: Job[] = [];
  for (const id of ids) {
    const job = await getJob(id);
    if (job && (!tenantId || job.tenantId === tenantId)) out.push(job);
    if (out.length >= limit) break;
  }
  return out;
}

/** Operator action: retry a dead-lettered job from scratch. */
export async function replayDead(id: string) {
  const r = redis();
  const raw = await r.hget(K.jobs, id);
  if (!raw || (await r.lrem(K.dead, 1, id)) === 0) return false;
  const job = JSON.parse(raw) as Job;
  job.attempts = 0;
  await r.hset(K.jobs, id, JSON.stringify(job));
  await r.lpush(K.ready, id);
  return true;
}

/** Short mutex – keeps messages of one conversation strictly ordered. */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ locked: false } | { locked: true; value: T }> {
  const r = redis();
  const token = randomUUID();
  const ok = await r.set(`lock:${key}`, token, "PX", ttlMs, "NX");
  if (!ok) return { locked: false };
  try {
    return { locked: true, value: await fn() };
  } finally {
    if ((await r.get(`lock:${key}`)) === token) await r.del(`lock:${key}`);
  }
}
