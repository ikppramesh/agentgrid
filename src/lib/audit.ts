import { Prisma } from "@prisma/client";
import { db } from "./db";
import { redactObject } from "./pii";
import { log, errorFields } from "./logger";

/** Append-only audit trail for security & compliance review. */
export async function audit(entry: {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await db.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        actorId: entry.actorId ?? "system",
        action: entry.action,
        target: entry.target,
        meta: redactObject(entry.meta ?? {}) as Prisma.InputJsonValue,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    // Never break the request because of audit write failure – but make it loud.
    log.error("audit.write_failed", { action: entry.action, ...errorFields(err) });
  }
}
