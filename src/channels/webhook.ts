import { z } from "zod";
import { signPayload } from "@/lib/crypto";

/**
 * Generic signed webhook channel. Lets any provider (WhatsApp Cloud API relay,
 * Messenger, SMS gateway, n8n/Zapier) push messages in and receive replies.
 *
 * Inbound:  POST /api/channels/webhook/:channelId   header X-AgentGrid-Signature: t=..,v1=hmac
 * Outbound: POST <outboundUrl>                      signed the same way with the same secret
 */
export const inboundSchema = z.object({
  messageId: z.string().min(1).max(200),
  from: z.object({ id: z.string().min(1).max(200), name: z.string().max(200).optional() }),
  text: z.string().min(1).max(4000),
  timestamp: z.number().optional(),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
});

export interface WebhookCredentials {
  secret: string;
  outboundUrl?: string;
}

export async function postSigned(url: string, secret: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agentgrid-signature": signPayload(secret, body) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = new Error(`webhook POST ${res.status}`) as Error & { permanent?: boolean };
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408;
    throw err;
  }
}
