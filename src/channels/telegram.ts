import { z } from "zod";

/** Telegram Bot API adapter (stand-in for WhatsApp Business API in this deployment). */
const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      date: z.number(),
      chat: z.object({ id: z.number(), type: z.string() }),
      from: z.object({ id: z.number(), first_name: z.string().optional(), last_name: z.string().optional(), language_code: z.string().optional() }).optional(),
      text: z.string().optional(),
    })
    .optional(),
});

export interface TelegramCredentials {
  botToken: string;
  webhookSecret: string; // echoed by Telegram in X-Telegram-Bot-Api-Secret-Token
}

export function parseUpdate(body: unknown) {
  const u = updateSchema.safeParse(body);
  if (!u.success || !u.data.message?.text) return null;
  const m = u.data.message;
  if (m.chat.type !== "private") return null; // groups not supported (privacy + consent)
  return {
    updateId: u.data.update_id,
    externalUserId: String(m.chat.id),
    externalMessageId: `tg:${m.chat.id}:${m.message_id}`,
    text: m.text!.slice(0, 4000),
    displayName: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || undefined,
    receivedAt: m.date * 1000,
    locale: m.from?.language_code,
  };
}

async function call(token: string, method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
  if (!res.ok || !data.ok) {
    const err = new Error(`telegram.${method} ${res.status}: ${data.description ?? "error"}`) as Error & { permanent?: boolean; retryAfter?: number };
    err.permanent = res.status === 400 || res.status === 403; // bad chat / bot blocked by user
    err.retryAfter = data.parameters?.retry_after;
    throw err;
  }
  return data;
}

export const sendMessage = (token: string, chatId: string, text: string) =>
  call(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: false });

export const setWebhook = (token: string, url: string, secret: string) =>
  call(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false });

export const getMe = (token: string) => call(token, "getMe", {});
