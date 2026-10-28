/** Long-running worker for local dev or a VM/container (Vercel uses cron + after()). */
import { registerJobs } from "../src/core/jobs";
import { drain } from "../src/lib/queue/worker";

registerJobs();
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

(async () => {
  console.log("AgentGrid worker started");
  while (!stopping) {
    const n = await drain(5000).catch((e) => (console.error(e), 0));
    if (n === 0) await new Promise((r) => setTimeout(r, 500));
  }
  process.exit(0);
})();
