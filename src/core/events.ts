import type { ChannelType } from "@prisma/client";

/**
 * Unified event model. Every channel adapter (Telegram, web chat, generic
 * webhook → WhatsApp/Messenger/SMS) normalizes into this before queueing, so
 * the conversational stack never sees channel-specific payloads.
 */
export interface InboundEvent {
  tenantId: string;
  agentId: string;
  channelId: string;
  channelType: ChannelType;
  externalUserId: string;
  externalMessageId: string;
  text: string;
  displayName?: string;
  receivedAt: number; // epoch ms – used for first-response SLA
  metadata?: Record<string, string>; // locale, UTM params, page url…
}

export const JOB = {
  inbound: "inbound.message",
  deliver: "outbound.deliver",
  workflow: "workflow.run",
  emit: "webhook.emit",
} as const;
