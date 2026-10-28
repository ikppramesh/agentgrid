import type { Role, TenantKind } from "@prisma/client";
import { db } from "./db";
import { generateWrappedDataKey } from "./crypto";

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

/** Provision a tenant with its own envelope-encrypted data key. */
export async function createTenant(opts: {
  name: string;
  kind: TenantKind;
  parentId?: string;
  plan?: string;
  ownerUserId?: string;
  ownerRole?: Role;
  sandbox?: boolean;
}) {
  const slug = slugify(opts.name);
  return db.tenant.create({
    data: {
      slug,
      name: opts.name,
      kind: opts.kind,
      parentId: opts.parentId,
      plan: opts.plan ?? "starter",
      sandbox: opts.sandbox ?? false,
      wrappedDataKey: generateWrappedDataKey(slug),
      memberships: opts.ownerUserId ? { create: { userId: opts.ownerUserId, role: opts.ownerRole ?? "OWNER" } } : undefined,
    },
  });
}
