import type { Agent, Channel, Conversation, Prisma, Tenant } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptForTenant, decryptJson, encryptForTenant, encryptJson } from "@/lib/crypto";
import { redactPii } from "@/lib/pii";
import { meter, quota } from "@/lib/metering";
import { audit } from "@/lib/audit";
import { log } from "@/lib/logger";
import { enqueue, withLock, type Job } from "@/lib/queue/queue";
import { DeferError, PermanentError } from "@/lib/queue/worker";
import { JOB, type InboundEvent } from "./events";
import { classify } from "./nlu";
import { decide, initialState, type DialogueState } from "./dialogue";
import { getTemplate, type WorkflowAction } from "./templates";
import { retrieve } from "./knowledge";
import { answer } from "./llm";
import { crmWebhook, hubspotUpsert, loadIntegrations, type Lead } from "./integrations";
import * as telegram from "@/channels/telegram";
import { postSigned, type WebhookCredentials } from "@/channels/webhook";

const PRIVACY_NOTICE =
  "ℹ️ This chat is handled by an AI assistant and may be reviewed by our team. Your details are used only to respond to you. Send STOP to opt out or 'delete my data' to erase your data anytime.";

export function brandName(tenant: Tenant & { parent?: Tenant | null }) {
  return tenant.brandName || tenant.parent?.brandName || tenant.name;
}

// ───────────────────────────── inbound ─────────────────────────────

export async function handleInbound(job: Job<InboundEvent>) {
  const ev = job.payload;
  const res = await withLock(`conv:${ev.channelId}:${ev.externalUserId}`, 45_000, () => processInbound(ev));
  if (!res.locked) throw new DeferError(1500, "conversation busy");
}

async function processInbound(ev: InboundEvent) {
  const tenant = await db.tenant.findUnique({ where: { id: ev.tenantId }, include: { parent: true } });
  const channel = await db.channel.findUnique({ where: { id: ev.channelId }, include: { agent: true } });
  if (!tenant || tenant.suspended || !channel?.active || !channel.agent.active) {
    log.warn("inbound.dropped", { tenantId: ev.tenantId, channelId: ev.channelId, reason: "inactive" });
    return;
  }
  const agent = channel.agent;
  const template = getTemplate(agent.templateId);

  // Contact (+ opt-out handling).
  const contact = await db.contact.upsert({
    where: { tenantId_channelType_externalId: { tenantId: tenant.id, channelType: ev.channelType, externalId: ev.externalUserId } },
    create: { tenantId: tenant.id, channelType: ev.channelType, externalId: ev.externalUserId, displayName: ev.displayName },
    update: {},
  });
  // Web chat captures explicit consent in the widget; other channels get a one-time notice.
  const needsNotice = ev.channelType !== "WEBCHAT" && !contact.consentAt;
  if (contact.optedOut) {
    if (!/^\/?start\b/i.test(ev.text.trim())) return; // honour opt-out: no processing, no reply
    await db.contact.update({ where: { id: contact.id }, data: { optedOut: false } });
  }

  // Open conversation or start a new one.
  let convo = await db.conversation.findFirst({
    where: { tenantId: tenant.id, channelId: channel.id, contactId: contact.id, status: { not: "RESOLVED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!convo) {
    convo = await db.conversation.create({
      data: { tenantId: tenant.id, agentId: agent.id, channelId: channel.id, contactId: contact.id, state: initialState() as unknown as Prisma.InputJsonValue },
    });
    await meter(tenant.id, { conversations: 1 });
  }

  // Idempotency at the data layer (queue already dedupes; this covers replays).
  if (await db.message.findFirst({ where: { conversationId: convo.id, externalId: ev.externalMessageId }, select: { id: true } })) return;

  await db.message.create({
    data: {
      tenantId: tenant.id,
      conversationId: convo.id,
      direction: "INBOUND",
      sender: "CONTACT",
      text: tenant.piiRedaction ? redactPii(ev.text) : ev.text,
      textEnc: encryptForTenant(tenant, ev.text),
      externalId: ev.externalMessageId,
    },
  });
  await meter(tenant.id, { messagesIn: 1 });
  await db.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });

  if (convo.status === "HANDOVER") return; // a human owns this conversation now

  const q = await quota(tenant.id, tenant.parent?.plan ?? tenant.plan);
  if (q.messagesExceeded) {
    await handover(tenant, convo, "quota_exceeded");
    return;
  }

  // NLU → dialogue manager.
  const nlu = classify(ev.text, template);
  const cfg = (agent.config ?? {}) as Record<string, string>;
  const prevState = { ...initialState(), ...(convo.state as unknown as DialogueState) };
  const decision = decide(template, prevState, nlu, ev.text, {
    handoverThreshold: agent.handoverThreshold,
    greeting: agent.greeting,
    links: { bookingLink: cfg.bookingLink ?? "", paymentLink: cfg.paymentLink ?? "" },
  });

  const outgoing: { text: string; meta?: Partial<Prisma.MessageCreateInput> }[] = [];
  if (needsNotice) {
    outgoing.push({ text: PRIVACY_NOTICE });
    await db.contact.update({ where: { id: contact.id }, data: { consentAt: new Date(), consentText: "notice:" + ev.channelType } });
  }

  let handoverReason = decision.handover;

  // Response generator for open questions.
  if (decision.answerQuestion && !handoverReason) {
    const history = await recentHistory(convo.id);
    const sources = await retrieve(tenant.id, agent.id, decision.answerQuestion);
    const a = await answer({
      question: decision.answerQuestion,
      sources,
      history,
      brand: brandName(tenant),
      persona: agent.persona,
      restricted: template.restricted,
      allowLlm: tenant.llmEnabled && !q.tokensExceeded,
      redactPii: tenant.piiRedaction,
    });
    if (a.source === "llm") {
      await meter(tenant.id, { llmCalls: 1, llmInputTokens: a.inputTokens ?? 0, llmOutputTokens: a.outputTokens ?? 0 });
    }
    if (a.handover) {
      // Only escalate if the dialogue has nothing useful to say either.
      if (decision.replies.length === 0 || prevState.step === "complete") handoverReason = "no_answer";
    } else {
      outgoing.push({
        text: a.text,
        meta: { model: a.model, promptVersion: a.promptVersion, inputTokens: a.inputTokens, outputTokens: a.outputTokens, latencyMs: a.latencyMs, guardrailFlags: a.flags },
      });
    }
  }

  if (handoverReason && !decision.handover) {
    outgoing.push({ text: "Let me connect you with a team member who can help with that. They'll reply here shortly." });
  }
  for (const r of decision.replies) outgoing.push({ text: r });

  // Persist state before side effects.
  await db.conversation.update({
    where: { id: convo.id },
    data: { state: decision.state as unknown as Prisma.InputJsonValue, qualified: decision.qualified || convo.qualified },
  });

  // Store slots (contain PII) encrypted on the contact profile.
  if (Object.keys(decision.state.slots).length) {
    const prev = contact.profileEnc ? decryptJson<Record<string, string>>(tenant, contact.profileEnc) : {};
    await db.contact.update({
      where: { id: contact.id },
      data: { profileEnc: encryptJson(tenant, { ...prev, ...decision.state.slots }), displayName: decision.state.slots.name ?? contact.displayName },
    });
  }

  for (const [i, o] of outgoing.entries()) {
    const msg = await db.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: convo.id,
        direction: "OUTBOUND",
        sender: "BOT",
        text: tenant.piiRedaction ? redactPii(o.text) : o.text,
        textEnc: encryptForTenant(tenant, o.text),
        intent: i === outgoing.length - 1 ? nlu.intent : undefined,
        confidence: i === outgoing.length - 1 ? nlu.confidence : undefined,
        ...(o.meta as object),
      },
    });
    await enqueue(JOB.deliver, tenant.id, { messageId: msg.id }, { idempotencyKey: `deliver:${msg.id}` });
  }
  // Annotate the inbound message with NLU output (model-ops dataset).
  await db.message.updateMany({ where: { conversationId: convo.id, externalId: ev.externalMessageId }, data: { intent: nlu.intent, confidence: nlu.confidence } });

  if (outgoing.length && convo.firstResponseMs == null) {
    await db.conversation.update({ where: { id: convo.id }, data: { firstResponseMs: Math.max(0, Date.now() - ev.receivedAt) } });
  }

  if (decision.actions.length) {
    await enqueue(JOB.workflow, tenant.id, { conversationId: convo.id, actions: decision.actions }, { idempotencyKey: `wf:${convo.id}:${ev.externalMessageId}` });
  }
  if (decision.optOut) await db.contact.update({ where: { id: contact.id }, data: { optedOut: true } });
  if (handoverReason) await handover(tenant, convo, handoverReason);
  if (decision.erase) {
    // Reply first (queued above with the text kept in the job), then erase after delivery window.
    await enqueue(JOB.workflow, tenant.id, { contactId: contact.id, actions: [{ type: "privacy.erase" }] }, { delayMs: 15_000 });
  }
}

async function recentHistory(conversationId: string) {
  const msgs = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 8 });
  return msgs.reverse().map((m) => `${m.sender === "CONTACT" ? "Customer" : "Assistant"}: ${m.text}`);
}

export async function handover(tenant: Tenant, convo: Conversation, reason: string) {
  await db.conversation.update({ where: { id: convo.id }, data: { status: "HANDOVER", handoverReason: reason } });
  await enqueue(JOB.emit, tenant.id, { event: "conversation.handover", data: { conversationId: convo.id, reason } });
  log.info("conversation.handover", { tenantId: tenant.id, conversationId: convo.id, reason });
}

// ───────────────────────────── delivery ─────────────────────────────

export async function deliver(job: Job<{ messageId: string }>) {
  const msg = await db.message.findUnique({
    where: { id: job.payload.messageId },
    include: { conversation: { include: { channel: true, contact: true, tenant: true } } },
  });
  if (!msg || msg.deliveredAt) return;
  const { channel, contact, tenant } = msg.conversation;
  const text = msg.textEnc ? decryptForTenant(tenant, msg.textEnc) : msg.text;

  try {
    await sendViaChannel(tenant, channel, contact.externalId, text, msg.conversationId, msg.id);
  } catch (err) {
    const e = err as Error & { permanent?: boolean; retryAfter?: number };
    if (e.retryAfter) throw new DeferError(e.retryAfter * 1000, "channel rate limit");
    if (e.permanent) throw new PermanentError(e.message);
    throw err;
  }
  await db.message.update({ where: { id: msg.id }, data: { deliveredAt: new Date() } });
  await meter(tenant.id, { messagesOut: 1 });
}

async function sendViaChannel(tenant: Tenant, channel: Channel, to: string, text: string, conversationId: string, messageId: string) {
  switch (channel.type) {
    case "WEBCHAT":
      return; // widget pulls messages from the API
    case "TELEGRAM": {
      const creds = decryptJson<telegram.TelegramCredentials>(tenant, channel.credentialsEnc);
      await telegram.sendMessage(creds.botToken, to, text);
      return;
    }
    case "WEBHOOK": {
      const creds = decryptJson<WebhookCredentials>(tenant, channel.credentialsEnc);
      if (!creds.outboundUrl) throw new PermanentError("Webhook channel has no outboundUrl");
      if (tenant.sandbox) return log.info("sandbox.skip_outbound", { tenantId: tenant.id, channelId: channel.id });
      await postSigned(creds.outboundUrl, creds.secret, { type: "message.outbound", to, text, conversationId, messageId });
      return;
    }
  }
}

// ───────────────────────────── workflows ─────────────────────────────

type WorkflowJob = { conversationId?: string; contactId?: string; actions: (WorkflowAction | { type: "privacy.erase" })[] };

/** Workflow runner: executes actions in order; the queue provides retries/backoff/DLQ. */
export async function runWorkflow(job: Job<WorkflowJob>) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: job.tenantId } });
  for (const action of job.payload.actions) {
    if (action.type === "privacy.erase") {
      if (job.payload.contactId) await eraseContact(tenant.id, job.payload.contactId, "system");
      continue;
    }
    const convo = await db.conversation.findUnique({ where: { id: job.payload.conversationId! }, include: { contact: true, agent: true } });
    if (!convo) return;
    const lead = buildLead(tenant, convo.contact.profileEnc, convo.id, convo.agent);
    if (tenant.sandbox) {
      log.info("sandbox.skip_action", { tenantId: tenant.id, action: action.type });
      continue;
    }
    switch (action.type) {
      case "crm.upsert_lead": {
        for (const h of await loadIntegrations(tenant, "hubspot")) await hubspotUpsert(h.accessToken, lead);
        for (const w of await loadIntegrations(tenant, "crm_webhook")) await crmWebhook(w, lead);
        break;
      }
      case "webhook.emit":
        await enqueue(JOB.emit, tenant.id, { event: action.event, data: { conversationId: convo.id, lead } });
        break;
      case "notify.handover":
        await enqueue(JOB.emit, tenant.id, { event: "conversation.handover", data: { conversationId: convo.id } });
        break;
    }
  }
  await meter(tenant.id, { workflowRuns: 1 });
}

function buildLead(tenant: Tenant, profileEnc: string | null, conversationId: string, agent: Agent): Lead {
  const fields = profileEnc ? decryptJson<Record<string, string>>(tenant, profileEnc) : {};
  return { name: fields.name, email: fields.email, phone: fields.phone, fields, conversationId, agentName: agent.name };
}

export async function emitWebhook(job: Job<{ event: string; data: unknown }>) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: job.tenantId } });
  if (tenant.sandbox) return;
  for (const hook of await loadIntegrations(tenant, "outbound_webhook")) {
    if (!hook.events.includes("*") && !hook.events.includes(job.payload.event)) continue;
    await postSigned(hook.url, hook.secret, { type: job.payload.event, tenantId: tenant.id, data: job.payload.data, at: new Date().toISOString() });
  }
}

// ───────────────────────────── privacy ─────────────────────────────

/** GDPR/DPDP right to erasure: delete messages & conversations, scrub the contact. */
export async function eraseContact(tenantId: string, contactId: string, actorId: string) {
  const contact = await db.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) return false;
  await db.$transaction([
    db.message.deleteMany({ where: { tenantId, conversation: { contactId } } }),
    db.conversation.deleteMany({ where: { tenantId, contactId } }),
    db.contact.update({ where: { id: contactId }, data: { displayName: null, profileEnc: null, consentText: null, optedOut: true } }),
  ]);
  await audit({ tenantId, actorId, action: "privacy.erase", target: contactId });
  return true;
}

/** GDPR right of access: everything we hold about a contact, decrypted. */
export async function exportContact(tenant: Tenant, contactId: string) {
  const contact = await db.contact.findFirst({
    where: { id: contactId, tenantId: tenant.id },
    include: { conversations: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!contact) return null;
  return {
    contact: {
      id: contact.id,
      channel: contact.channelType,
      displayName: contact.displayName,
      profile: contact.profileEnc ? decryptJson(tenant, contact.profileEnc) : {},
      consentAt: contact.consentAt,
      optedOut: contact.optedOut,
    },
    conversations: contact.conversations.map((c) => ({
      id: c.id,
      status: c.status,
      createdAt: c.createdAt,
      messages: c.messages.map((m) => ({ at: m.createdAt, from: m.sender, text: m.textEnc ? decryptForTenant(tenant, m.textEnc) : m.text })),
    })),
  };
}
