import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  MASTER_KEY: z.string().min(32, "MASTER_KEY must be a base64 32-byte key"),
  SESSION_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(16),
  METRICS_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  LLM_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  QUEUE_DRAIN_BUDGET_MS: z.coerce.number().int().min(1000).default(8000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Fails fast on misconfiguration instead of at first use. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
