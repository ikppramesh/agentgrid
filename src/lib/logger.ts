import { redactObject } from "./pii";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Structured JSON logger. Every field is PII-redacted and secrets are masked,
 * so logs (Vercel log drains, ELK, Datadog) only ever carry metadata.
 */
function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redactObject(fields) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === "debug") write("debug", msg, f);
  },
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};

export function errorFields(err: unknown) {
  return err instanceof Error ? { error: err.message, errorName: err.name } : { error: String(err) };
}
