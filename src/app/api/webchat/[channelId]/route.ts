import { z } from "zod";
import { randomUUID } from "node:crypto";
import { loadChannel } from "@/channels/lookup";
import { ingest } from "@/core/ingest";
import { db } from "@/lib/db";
import { handleError, json, clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { brandName } from "@/core/engine";
import { decryptForTenant } from "@/lib/crypto";

export const runtime = "nodejs";

const visitorId = z.string().uuid();
const postSchema = z.object({
  visitorId,
  text: z.string().trim().min(1).max(2000),
  consent: z.literal(true), // explicit consent captured in the widget before first message
  metadata: z.record(z.string(), z.string().max(500)).optional(),
});

const CONSENT_TEXT = "webchat:ai-assistant-processing-v1";

/** Visitor sends a message. */
export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params;
    const ipLimit = await rateLimit(`webchat-ip:${clientIp(req) ?? "unknown"}`, 30);
    if (!ipLimit.allowed) return json({ error: "Slow down" }, 429);
    const { channel, planId } = await loadChannel<Record<string, never>>(channelId, "WEBCHAT");
    const body = postSchema.parse(await req.json());

    await db.contact.upsert({
      where: { tenantId_channelType_externalId: { tenantId: channel.tenantId, channelType: "WEBCHAT", externalId: body.visitorId } },
      create: { tenantId: channel.tenantId, channelType: "WEBCHAT", externalId: body.visitorId, consentAt: new Date(), consentText: CONSENT_TEXT },
      update: {},
    });

    const res = await ingest(
      {
        tenantId: channel.tenantId,
        agentId: channel.agentId,
        channelId: channel.id,
        channelType: "WEBCHAT",
        externalUserId: body.visitorId,
        externalMessageId: `wc:${randomUUID()}`,
        text: body.text,
        receivedAt: Date.now(),
        metadata: body.metadata,
      },
      planId,
    );
    if (res.status === 429) return json({ error: "Busy, try again shortly" }, 429);
    return json({ accepted: true }, 202);
  } catch (err) {
    return handleError(err);
  }
}

/** Widget polls for the transcript of its open conversation. */
export async function GET(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params;
    const url = new URL(req.url);
    const vid = visitorId.parse(url.searchParams.get("visitorId"));
    const { channel, tenant } = await loadChannel<Record<string, never>>(channelId, "WEBCHAT");
    const contact = await db.contact.findUnique({
      where: { tenantId_channelType_externalId: { tenantId: channel.tenantId, channelType: "WEBCHAT", externalId: vid } },
    });
    const convo = contact
      ? await db.conversation.findFirst({ where: { contactId: contact.id, channelId: channel.id }, orderBy: { createdAt: "desc" } })
      : null;
    const messages = convo
      ? await db.message.findMany({
          where: { conversationId: convo.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, sender: true, text: true, textEnc: true, createdAt: true },
          take: 200,
        })
      : [];
    return json({
      brand: { name: brandName(tenant), color: tenant.brandColor ?? tenant.parent?.brandColor ?? "#4f46e5", logo: tenant.brandLogoUrl ?? tenant.parent?.brandLogoUrl },
      status: convo?.status ?? "NEW",
      // The visitor id is an unguessable UUID held only by this browser, so it sees its own original text.
      messages: messages.map(({ textEnc, ...m }) => ({ ...m, text: textEnc ? decryptForTenant(tenant, textEnc) : m.text })),
    });
  } catch (err) {
    return handleError(err);
  }
}
