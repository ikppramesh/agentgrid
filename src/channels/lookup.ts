import type { ChannelType } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { HttpError } from "@/lib/http";

/** Load an active channel + its tenant and decrypted credentials. 404 on any mismatch. */
export async function loadChannel<C>(channelId: string, type: ChannelType) {
  const channel = await db.channel.findUnique({ where: { id: channelId }, include: { tenant: { include: { parent: true } } } });
  if (!channel || channel.type !== type || !channel.active || channel.tenant.suspended) throw new HttpError(404, "Not found");
  const creds = decryptJson<C>(channel.tenant, channel.credentialsEnc);
  return { channel, tenant: channel.tenant, creds, planId: channel.tenant.parent?.plan ?? channel.tenant.plan };
}
