import { loadChannel } from "@/channels/lookup";
import { inboundSchema, type WebhookCredentials } from "@/channels/webhook";
import { ingest } from "@/core/ingest";
import { verifySignature } from "@/lib/crypto";
import { handleError, json } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Generic inbound webhook (WhatsApp / Messenger / SMS bridge, n8n, Zapier).
 * Requires X-AgentGrid-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>.
 */
export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params;
    const { channel, creds, planId } = await loadChannel<WebhookCredentials>(channelId, "WEBHOOK");
    const raw = await req.text();
    if (raw.length > 64_000) return json({ error: "Payload too large" }, 413);
    if (!verifySignature(creds.secret, raw, req.headers.get("x-agentgrid-signature"))) {
      return json({ error: "Invalid signature" }, 401);
    }
    const body = inboundSchema.parse(JSON.parse(raw));
    const res = await ingest(
      {
        tenantId: channel.tenantId,
        agentId: channel.agentId,
        channelId: channel.id,
        channelType: "WEBHOOK",
        externalUserId: body.from.id,
        externalMessageId: body.messageId,
        text: body.text,
        displayName: body.from.name,
        receivedAt: Date.now(),
        metadata: body.metadata,
      },
      planId,
    );
    if (res.status === 429) return json({ error: "Rate limited" }, 429, { "retry-after": "60" });
    return json({ accepted: true, duplicate: res.duplicate }, 202);
  } catch (err) {
    return handleError(err);
  }
}
