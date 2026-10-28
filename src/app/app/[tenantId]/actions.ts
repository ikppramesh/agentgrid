"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/auth/access";
import { hashPassword, revokeUserSessions } from "@/lib/auth/session";
import { ROLE_RANK } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import { encryptForTenant, encryptJson, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { planFor } from "@/lib/plans";
import { createTenant } from "@/lib/tenants";
import { enqueue, getJob, replayDead } from "@/lib/queue/queue";
import { JOB } from "@/core/events";
import { getTemplate } from "@/core/templates";
import { integrationSchemas, type IntegrationKind } from "@/core/integrations";
import { redactPii } from "@/lib/pii";
import { createReveal } from "@/lib/reveal";
import * as telegram from "@/channels/telegram";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const path = (tenantId: string, p = "") => `/app/${tenantId}${p}`;

// ───────────── conversations / human handover ─────────────

export async function replyAction(tenantId: string, conversationId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "conversation:reply");
  const text = z.string().min(1).max(4000).parse(str(fd, "text"));
  const convo = await db.conversation.findFirstOrThrow({ where: { id: conversationId, tenantId } });
  const msg = await db.message.create({
    data: {
      tenantId,
      conversationId: convo.id,
      direction: "OUTBOUND",
      sender: "HUMAN",
      text: tenant.piiRedaction ? redactPii(text) : text,
      textEnc: encryptForTenant(tenant, text),
    },
  });
  await db.conversation.update({ where: { id: convo.id }, data: { status: "HANDOVER", assignedUserId: session.userId } });
  await enqueue(JOB.deliver, tenantId, { messageId: msg.id }, { idempotencyKey: `deliver:${msg.id}` });
  await audit({ tenantId, actorId: session.userId, action: "conversation.reply", target: convo.id });
  revalidatePath(path(tenantId, `/conversations/${conversationId}`));
}

export async function setStatusAction(tenantId: string, conversationId: string, status: "BOT" | "HANDOVER" | "RESOLVED") {
  const { session } = await authorize(tenantId, "conversation:reply");
  await db.conversation.updateMany({
    where: { id: conversationId, tenantId },
    data: {
      status,
      assignedUserId: status === "HANDOVER" ? session.userId : null,
      resolvedAt: status === "RESOLVED" ? new Date() : null,
      ...(status === "BOT" ? { handoverReason: null } : {}),
    },
  });
  await audit({ tenantId, actorId: session.userId, action: `conversation.${status.toLowerCase()}`, target: conversationId });
  revalidatePath(path(tenantId, `/conversations/${conversationId}`));
}

/** Model-ops feedback loop: a human corrects the detected intent. */
export async function labelIntentAction(tenantId: string, messageId: string, fd: FormData) {
  const { session } = await authorize(tenantId, "conversation:reply");
  const label = z.string().min(1).max(60).regex(/^[a-z_]+$/).parse(str(fd, "label"));
  const m = await db.message.updateMany({ where: { id: messageId, tenantId }, data: { labeledIntent: label } });
  if (m.count) await audit({ tenantId, actorId: session.userId, action: "nlu.label", target: messageId, meta: { label } });
  revalidatePath(path(tenantId, "/conversations"), "layout");
}

// ───────────── agents & knowledge ─────────────

export async function createAgentAction(tenantId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "agent:manage");
  const template = getTemplate(str(fd, "templateId"));
  const name = z.string().min(2).max(80).parse(str(fd, "name") || template.name);
  const count = await db.agent.count({ where: { tenantId } });
  if (count >= planFor(tenant.plan).maxAgents) throw new Error("Agent limit reached for your plan");
  const agent = await db.agent.create({ data: { tenantId, name, templateId: template.id } });
  await db.knowledgeItem.createMany({ data: template.knowledge.map((k) => ({ ...k, tenantId, agentId: agent.id })) });
  // Every agent gets a web chat channel out of the box.
  await db.channel.create({ data: { tenantId, agentId: agent.id, type: "WEBCHAT", name: "Website chat", credentialsEnc: encryptJson(tenant, {}) } });
  await audit({ tenantId, actorId: session.userId, action: "agent.create", target: agent.id, meta: { template: template.id } });
  redirect(path(tenantId, `/agents/${agent.id}`));
}

const agentSchema = z.object({
  name: z.string().min(2).max(80),
  persona: z.string().max(2000),
  greeting: z.string().max(500),
  handoverThreshold: z.coerce.number().min(0).max(1),
  bookingLink: z.union([z.literal(""), z.string().url()]),
  paymentLink: z.union([z.literal(""), z.string().url()]),
  active: z.boolean(),
});

export async function updateAgentAction(tenantId: string, agentId: string, fd: FormData) {
  const { session } = await authorize(tenantId, "agent:manage");
  const v = agentSchema.parse({
    name: str(fd, "name"),
    persona: str(fd, "persona"),
    greeting: str(fd, "greeting"),
    handoverThreshold: str(fd, "handoverThreshold"),
    bookingLink: str(fd, "bookingLink"),
    paymentLink: str(fd, "paymentLink"),
    active: fd.get("active") === "on",
  });
  await db.agent.updateMany({
    where: { id: agentId, tenantId },
    data: {
      name: v.name,
      persona: v.persona,
      greeting: v.greeting || null,
      handoverThreshold: v.handoverThreshold,
      active: v.active,
      config: { bookingLink: v.bookingLink, paymentLink: v.paymentLink },
    },
  });
  await audit({ tenantId, actorId: session.userId, action: "agent.update", target: agentId });
  revalidatePath(path(tenantId, `/agents/${agentId}`));
}

export async function addKnowledgeAction(tenantId: string, agentId: string, fd: FormData) {
  const { session } = await authorize(tenantId, "agent:manage");
  const title = z.string().min(2).max(200).parse(str(fd, "title"));
  const content = z.string().min(2).max(8000).parse(str(fd, "content"));
  const tags = str(fd, "tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  await db.knowledgeItem.create({ data: { tenantId, agentId, title, content, tags } });
  await audit({ tenantId, actorId: session.userId, action: "knowledge.add", target: agentId, meta: { title } });
  revalidatePath(path(tenantId, `/agents/${agentId}`));
}

export async function deleteKnowledgeAction(tenantId: string, agentId: string, itemId: string) {
  const { session } = await authorize(tenantId, "agent:manage");
  await db.knowledgeItem.deleteMany({ where: { id: itemId, tenantId } });
  await audit({ tenantId, actorId: session.userId, action: "knowledge.delete", target: itemId });
  revalidatePath(path(tenantId, `/agents/${agentId}`));
}

// ───────────── channels ─────────────

export async function connectTelegramAction(tenantId: string, agentId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "agent:manage");
  const botToken = z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "Invalid bot token").parse(str(fd, "botToken"));
  await db.agent.findFirstOrThrow({ where: { id: agentId, tenantId } });
  const me = (await telegram.getMe(botToken)) as { result?: { username?: string } };
  const webhookSecret = randomToken(24);
  const channel = await db.channel.create({
    data: {
      tenantId,
      agentId,
      type: "TELEGRAM",
      name: `Telegram @${me.result?.username ?? "bot"}`,
      credentialsEnc: encryptJson(tenant, { botToken, webhookSecret }),
    },
  });
  await telegram.setWebhook(botToken, `${env().APP_URL}/api/channels/telegram/${channel.id}`, webhookSecret);
  await audit({ tenantId, actorId: session.userId, action: "channel.create", target: channel.id, meta: { type: "TELEGRAM" } });
  revalidatePath(path(tenantId, `/agents/${agentId}`));
}

export async function createWebhookChannelAction(tenantId: string, agentId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "agent:manage");
  const outboundUrl = z.string().url().startsWith("https://", "Outbound URL must use HTTPS").parse(str(fd, "outboundUrl"));
  const name = z.string().min(2).max(80).parse(str(fd, "name") || "WhatsApp bridge");
  await db.agent.findFirstOrThrow({ where: { id: agentId, tenantId } });
  const secret = randomToken(32);
  const channel = await db.channel.create({
    data: { tenantId, agentId, type: "WEBHOOK", name, credentialsEnc: encryptJson(tenant, { secret, outboundUrl }) },
  });
  await audit({ tenantId, actorId: session.userId, action: "channel.create", target: channel.id, meta: { type: "WEBHOOK" } });
  // The signing secret is shown once on the next page load, then never again.
  const ticket = await createReveal(tenantId, { channelId: channel.id, secret });
  redirect(path(tenantId, `/agents/${agentId}?reveal=${ticket}`));
}

export async function toggleChannelAction(tenantId: string, agentId: string, channelId: string, active: boolean) {
  const { session } = await authorize(tenantId, "agent:manage");
  await db.channel.updateMany({ where: { id: channelId, tenantId }, data: { active } });
  await audit({ tenantId, actorId: session.userId, action: active ? "channel.enable" : "channel.disable", target: channelId });
  revalidatePath(path(tenantId, `/agents/${agentId}`));
}

// ───────────── settings: branding, compliance, integrations, SSO, members ─────────────

export async function updateSettingsAction(tenantId: string, fd: FormData) {
  const { session, tenant } = await authorize(tenantId, "tenant:manage");
  const v = z
    .object({
      brandName: z.string().max(80),
      brandLogoUrl: z.union([z.literal(""), z.string().url().startsWith("https://")]),
      brandColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
      retentionDays: z.coerce.number().int().min(7).max(3650),
    })
    .parse({ brandName: str(fd, "brandName"), brandLogoUrl: str(fd, "brandLogoUrl"), brandColor: str(fd, "brandColor"), retentionDays: str(fd, "retentionDays") });
  const whiteLabel = planFor(tenant.plan).whiteLabel || tenant.parentId != null;
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      ...(whiteLabel ? { brandName: v.brandName || null, brandLogoUrl: v.brandLogoUrl || null, brandColor: v.brandColor || null } : {}),
      retentionDays: v.retentionDays,
      llmEnabled: fd.get("llmEnabled") === "on",
      piiRedaction: fd.get("piiRedaction") === "on",
    },
  });
  await audit({ tenantId, actorId: session.userId, action: "tenant.settings", meta: { ...v, llmEnabled: fd.get("llmEnabled") === "on" } });
  revalidatePath(path(tenantId, "/settings"));
}

export async function addIntegrationAction(tenantId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "tenant:manage");
  const kind = z.enum(["hubspot", "crm_webhook", "outbound_webhook"]).parse(str(fd, "kind")) as IntegrationKind;
  const raw: Record<string, unknown> = { accessToken: str(fd, "accessToken"), url: str(fd, "url"), secret: str(fd, "secret") || randomToken(24) };
  if (kind === "outbound_webhook") raw.events = (str(fd, "events") || "*").split(",").map((e) => e.trim());
  const config = integrationSchemas[kind].parse(raw);
  await db.integration.create({ data: { tenantId, kind, configEnc: encryptJson(tenant, config) } });
  await audit({ tenantId, actorId: session.userId, action: "integration.add", meta: { kind } });
  revalidatePath(path(tenantId, "/settings"));
}

export async function removeIntegrationAction(tenantId: string, integrationId: string) {
  const { session } = await authorize(tenantId, "tenant:manage");
  await db.integration.deleteMany({ where: { id: integrationId, tenantId } });
  await audit({ tenantId, actorId: session.userId, action: "integration.remove", target: integrationId });
  revalidatePath(path(tenantId, "/settings"));
}

export async function saveSsoAction(tenantId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "tenant:manage");
  if (!planFor(tenant.plan).sso) throw new Error("SSO requires the Growth plan or above");
  const v = z
    .object({
      issuer: z.string().url().startsWith("https://"),
      clientId: z.string().min(3).max(300),
      clientSecret: z.string().min(3).max(500),
      allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)),
      defaultRole: z.enum(["VIEWER", "OPERATOR", "ADMIN"]),
    })
    .parse({
      issuer: str(fd, "issuer"),
      clientId: str(fd, "clientId"),
      clientSecret: str(fd, "clientSecret"),
      allowedDomains: str(fd, "allowedDomains").toLowerCase().split(",").map((d) => d.trim()).filter(Boolean),
      defaultRole: str(fd, "defaultRole") || "VIEWER",
    });
  const data = {
    issuer: v.issuer.replace(/\/$/, ""),
    clientId: v.clientId,
    clientSecretEnc: encryptForTenant(tenant, v.clientSecret),
    allowedDomains: v.allowedDomains,
    defaultRole: v.defaultRole,
    enforced: fd.get("enforced") === "on",
  };
  await db.ssoConfig.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  await audit({ tenantId, actorId: session.userId, action: "sso.configure", meta: { issuer: v.issuer, enforced: data.enforced } });
  revalidatePath(path(tenantId, "/settings"));
}

export async function inviteMemberAction(tenantId: string, fd: FormData) {
  const { session, role: myRole } = await authorize(tenantId, "tenant:manage");
  const email = z.string().email().parse(str(fd, "email").toLowerCase());
  const role = z.enum(["OWNER", "ADMIN", "OPERATOR", "VIEWER"]).parse(str(fd, "role")) as Role;
  if (ROLE_RANK[role] > ROLE_RANK[myRole]) throw new Error("Cannot grant a role higher than your own");
  const existing = await db.user.findUnique({ where: { email } });
  const tempPassword = existing ? "" : randomToken(12);
  const user = existing ?? (await db.user.create({ data: { email, passwordHash: await hashPassword(tempPassword) } }));
  await db.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    create: { userId: user.id, tenantId, role },
    update: { role },
  });
  await audit({ tenantId, actorId: session.userId, action: "member.invite", target: user.id, meta: { role } });
  // In production send the invite via your email provider; here it is revealed once to the inviter.
  const ticket = await createReveal(tenantId, { email, tempPassword });
  redirect(path(tenantId, `/settings?reveal=${ticket}`));
}

export async function removeMemberAction(tenantId: string, userId: string) {
  const { session } = await authorize(tenantId, "tenant:manage");
  if (userId === session.userId) throw new Error("You cannot remove yourself");
  await db.membership.deleteMany({ where: { tenantId, userId } });
  await revokeUserSessions(userId);
  await audit({ tenantId, actorId: session.userId, action: "member.remove", target: userId });
  revalidatePath(path(tenantId, "/settings"));
}

// ───────────── agency: client tenants ─────────────

export async function createClientAction(tenantId: string, fd: FormData) {
  const { tenant, session } = await authorize(tenantId, "clients:manage");
  if (tenant.kind !== "AGENCY") throw new Error("Only agencies can create client workspaces");
  const name = z.string().min(2).max(80).parse(str(fd, "name"));
  const client = await createTenant({ name, kind: "CLIENT", parentId: tenant.id, plan: tenant.plan, sandbox: fd.get("sandbox") === "on" });
  await audit({ tenantId, actorId: session.userId, action: "client.create", target: client.id, meta: { sandbox: client.sandbox } });
  revalidatePath(path(tenantId, "/clients"));
}

export async function setClientFlagsAction(tenantId: string, clientId: string, flags: { sandbox?: boolean; suspended?: boolean }) {
  const { session } = await authorize(tenantId, "clients:manage");
  await db.tenant.updateMany({ where: { id: clientId, parentId: tenantId }, data: flags });
  await audit({ tenantId, actorId: session.userId, action: "client.flags", target: clientId, meta: flags });
  revalidatePath(path(tenantId, "/clients"));
}

// ───────────── operations ─────────────

export async function replayDeadLetterAction(tenantId: string, jobId: string) {
  const { session } = await authorize(tenantId, "tenant:manage");
  const job = await getJob(jobId);
  if (!job || job.tenantId !== tenantId) throw new Error("Not found");
  await replayDead(jobId);
  await audit({ tenantId, actorId: session.userId, action: "queue.replay", target: jobId });
  revalidatePath(path(tenantId, "/sla"));
}
