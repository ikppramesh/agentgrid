import { registerJobs } from "@/core/jobs";
import { drain } from "@/lib/queue/worker";
import { stats } from "@/lib/queue/queue";
import { handleError, json, requireCron } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel Cron (every minute): retries, delayed jobs, crash recovery, backlog. */
export async function GET(req: Request) {
  try {
    requireCron(req);
    registerJobs();
    const processed = await drain(50_000);
    return json({ processed, queue: await stats() });
  } catch (err) {
    return handleError(err);
  }
}
