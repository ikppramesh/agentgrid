import { db } from "./db";
import { redis } from "./redis";
import { planFor } from "./plans";

export type UsageField =
  | "messagesIn"
  | "messagesOut"
  | "conversations"
  | "llmCalls"
  | "llmInputTokens"
  | "llmOutputTokens"
  | "workflowRuns";

export function currentPeriod(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

/** Atomic usage metering per tenant per month (source of truth for billing). */
export async function meter(tenantId: string, inc: Partial<Record<UsageField, number>>) {
  const period = currentPeriod();
  await db.usageRecord.upsert({
    where: { tenantId_period: { tenantId, period } },
    create: { tenantId, period, ...inc },
    update: Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, { increment: v }])),
  });
  await redis().del(`quota:${tenantId}:${period}`);
}

export interface QuotaStatus {
  messagesUsed: number;
  messagesLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  messagesExceeded: boolean;
  tokensExceeded: boolean;
}

/** Quota check with a short Redis cache to keep the hot path cheap. */
export async function quota(tenantId: string, planId: string): Promise<QuotaStatus> {
  const period = currentPeriod();
  const key = `quota:${tenantId}:${period}`;
  const cached = await redis().get(key);
  let used: { m: number; t: number };
  if (cached) used = JSON.parse(cached);
  else {
    const rec = await db.usageRecord.findUnique({ where: { tenantId_period: { tenantId, period } } });
    used = {
      m: (rec?.messagesIn ?? 0) + (rec?.messagesOut ?? 0),
      t: (rec?.llmInputTokens ?? 0) + (rec?.llmOutputTokens ?? 0),
    };
    await redis().set(key, JSON.stringify(used), "EX", 60);
  }
  const plan = planFor(planId);
  return {
    messagesUsed: used.m,
    messagesLimit: plan.monthlyMessages,
    tokensUsed: used.t,
    tokensLimit: plan.monthlyLlmTokens,
    messagesExceeded: used.m >= plan.monthlyMessages,
    tokensExceeded: used.t >= plan.monthlyLlmTokens,
  };
}
