import { ack, claim, defer, fail, promoteDue, reclaimExpired, type Job } from "./queue";
import { log, errorFields } from "../logger";

export class DeferError extends Error {
  constructor(public delayMs: number, reason: string) {
    super(reason);
  }
}

/** Errors that will never succeed on retry (bad config, validation) go straight to DLQ. */
export class PermanentError extends Error {}

export type Handler = (job: Job) => Promise<void>;
const handlers = new Map<string, Handler>();

export function register(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export async function processJob(job: Job) {
  const handler = handlers.get(job.type);
  const started = Date.now();
  try {
    if (!handler) throw new PermanentError(`No handler for ${job.type}`);
    await handler(job);
    await ack(job.id);
    log.info("job.done", { jobId: job.id, type: job.type, tenantId: job.tenantId, ms: Date.now() - started });
  } catch (err) {
    if (err instanceof DeferError) {
      await defer(job, err.delayMs);
      return;
    }
    if (err instanceof PermanentError) job.attempts = job.maxAttempts - 1;
    const outcome = await fail(job, err instanceof Error ? err.message : String(err));
    log[outcome === "dead" ? "error" : "warn"]("job.failed", {
      jobId: job.id,
      type: job.type,
      tenantId: job.tenantId,
      attempt: job.attempts,
      outcome,
      ...errorFields(err),
    });
  }
}

/**
 * Drain the queue within a time budget. Called:
 *  - right after a webhook is accepted (Next.js `after()` – low latency),
 *  - by Vercel Cron every minute (retries, delayed jobs, crash recovery),
 *  - in a loop by `npm run worker` locally / on a long-running host.
 */
export async function drain(budgetMs = Number(process.env.QUEUE_DRAIN_BUDGET_MS ?? 8000), concurrency = 4) {
  const deadline = Date.now() + budgetMs;
  await reclaimExpired();
  await promoteDue();
  let processed = 0;
  const lane = async () => {
    while (Date.now() < deadline) {
      const job = await claim();
      if (!job) return;
      await processJob(job);
      processed++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  return processed;
}
