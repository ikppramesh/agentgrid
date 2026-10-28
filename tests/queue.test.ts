import { beforeEach, describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import type Redis from "ioredis";
import { setRedis } from "@/lib/redis";
import { enqueue, claim, ack, fail, promoteDue, reclaimExpired, stats, deadLetters, replayDead } from "@/lib/queue/queue";
import { drain, register, DeferError } from "@/lib/queue/worker";

beforeEach(async () => {
  const r = new RedisMock() as unknown as Redis;
  await r.flushall();
  setRedis(r);
});

describe("queue", () => {
  it("dedupes by idempotency key (webhook redelivery)", async () => {
    expect((await enqueue("t", "ten", {}, { idempotencyKey: "tg:1" })).enqueued).toBe(true);
    expect((await enqueue("t", "ten", {}, { idempotencyKey: "tg:1" })).enqueued).toBe(false);
    expect((await stats()).ready).toBe(1);
  });

  it("claims, acks", async () => {
    await enqueue("t", "ten", { a: 1 });
    const job = await claim();
    expect(job?.payload).toEqual({ a: 1 });
    expect((await stats()).processing).toBe(1);
    await ack(job!.id);
    expect(await stats()).toEqual({ ready: 0, processing: 0, delayed: 0, dead: 0 });
  });

  it("retries with backoff then dead-letters, and can replay", async () => {
    await enqueue("t", "ten", {}, { maxAttempts: 2 });
    let job = (await claim())!;
    expect(await fail(job, "boom")).toBe("retry");
    expect((await stats()).delayed).toBe(1);
    expect(await promoteDue(Date.now() + 10 * 60_000)).toBe(1);
    job = (await claim())!;
    expect(await fail(job, "boom again")).toBe("dead");
    const dead = await deadLetters("ten");
    expect(dead[0].lastError).toBe("boom again");
    expect(await replayDead(job.id)).toBe(true);
    expect((await stats()).ready).toBe(1);
  });

  it("recovers jobs from crashed workers", async () => {
    await enqueue("t", "ten", {});
    await claim();
    expect(await reclaimExpired(Date.now() + 120_000)).toBe(1);
    expect((await stats()).ready).toBe(1);
  });

  it("drain runs handlers and defers without burning attempts", async () => {
    const seen: string[] = [];
    let deferred = false;
    register("ok", async (j) => void seen.push(j.id));
    register("busy", async () => {
      if (!deferred) {
        deferred = true;
        throw new DeferError(1, "locked");
      }
    });
    await enqueue("ok", "ten", {});
    await enqueue("busy", "ten", {});
    await drain(1000, 1);
    expect(seen).toHaveLength(1);
    expect((await stats()).delayed).toBe(1);
  });
});
