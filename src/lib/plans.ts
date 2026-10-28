/**
 * Commercial plans with quotas and SLA tiers. Targets are contractual goals
 * tracked on the SLA page, not claimed results.
 */
export interface Plan {
  id: string;
  name: string;
  maxAgents: number;
  monthlyMessages: number;
  monthlyLlmTokens: number;
  ratePerMinute: number; // inbound messages per tenant per minute
  sla: {
    uptimeTarget: number; // percent
    firstResponseP95Ms: number;
    supportResponseHours: number;
    deliverySuccessTarget: number; // percent of outbound messages delivered
  };
  whiteLabel: boolean;
  sso: boolean;
}

export const PLANS: Record<string, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    maxAgents: 2,
    monthlyMessages: 5_000,
    monthlyLlmTokens: 2_000_000,
    ratePerMinute: 60,
    sla: { uptimeTarget: 99.5, firstResponseP95Ms: 5000, supportResponseHours: 48, deliverySuccessTarget: 99 },
    whiteLabel: false,
    sso: false,
  },
  growth: {
    id: "growth",
    name: "Growth",
    maxAgents: 10,
    monthlyMessages: 50_000,
    monthlyLlmTokens: 20_000_000,
    ratePerMinute: 300,
    sla: { uptimeTarget: 99.9, firstResponseP95Ms: 3000, supportResponseHours: 12, deliverySuccessTarget: 99.5 },
    whiteLabel: true,
    sso: true,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    maxAgents: 100,
    monthlyMessages: 1_000_000,
    monthlyLlmTokens: 300_000_000,
    ratePerMinute: 2000,
    sla: { uptimeTarget: 99.95, firstResponseP95Ms: 2000, supportResponseHours: 2, deliverySuccessTarget: 99.9 },
    whiteLabel: true,
    sso: true,
  },
};

export function planFor(id: string): Plan {
  return PLANS[id] ?? PLANS.starter;
}
