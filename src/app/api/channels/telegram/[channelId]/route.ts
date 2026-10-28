import { loadChannel } from "@/channels/lookup";
import { parseUpdate, type TelegramCredentials } from "@/channels/telegram";
import { ingest } from "@/core/ingest";
import { safeEqual } from "@/lib/crypto";
import { handleError, json } from "@/lib/http";

export const runtime = "nodejs";

/** Telegram webhook. Authenticated by the secret_token we registered with setWebhook. */
export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params;
    const { channel, creds, planId } = await loadChannel<TelegramCredentials>(channelId, "TELEGRAM");
    const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!safeEqual(header, creds.webhookSecret)) return json({ error: "Unauthorized" }, 401);

    const update = parseUpdate(await req.json());
    if (!update) return json({ ok: true, ignored: true }); // non-text / group updates

    const res = await ingest(
      {
        tenantId: channel.tenantId,
        agentId: channel.agentId,
        channelId: channel.id,
        channelType: "TELEGRAM",
        externalUserId: update.externalUserId,
        externalMessageId: update.externalMessageId,
        text: update.text,
        displayName: update.displayName,
        receivedAt: Date.now(),
        metadata: update.locale ? { locale: update.locale } : undefined,
      },
      planId,
    );
    // Telegram retries non-2xx; on rate limit we still ack to avoid a retry storm (message is dropped & logged).
    return json({ ok: true, ...res });
  } catch (err) {
    return handleError(err);
  }
}
