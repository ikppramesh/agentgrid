import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { env } from "./env";
import { safeEqual } from "./crypto";
import { log, errorFields } from "./logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}

/** Uniform error responses; never leaks internals. */
export function handleError(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof ZodError) return json({ error: "Invalid request", issues: err.issues.map((i) => i.path.join(".")) }, 400);
  log.error("http.unhandled", errorFields(err));
  return json({ error: "Internal error" }, 500);
}

export function requireCron(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${env().CRON_SECRET}`)) throw new HttpError(401, "Unauthorized");
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
}
