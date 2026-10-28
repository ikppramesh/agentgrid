import { register } from "@/lib/queue/worker";
import { JOB, type InboundEvent } from "./events";
import { deliver, emitWebhook, handleInbound, runWorkflow } from "./engine";
import type { Job } from "@/lib/queue/queue";

let registered = false;

/** Wire job types to handlers. Import-safe; call before draining. */
export function registerJobs() {
  if (registered) return;
  register(JOB.inbound, (job) => handleInbound(job as Job<InboundEvent>));
  register(JOB.deliver, (job) => deliver(job as Job<{ messageId: string }>));
  register(JOB.workflow, (job) => runWorkflow(job as Parameters<typeof runWorkflow>[0]));
  register(JOB.emit, (job) => emitWebhook(job as Job<{ event: string; data: unknown }>));
  registered = true;
}
