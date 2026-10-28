/**
 * Demo data: an agency with a client (real-estate) and a direct business (clinic).
 *   npm run db:seed   → prints login credentials
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { generateWrappedDataKey, encryptJson } from "../src/lib/crypto";
import { getTemplate } from "../src/core/templates";

const db = new PrismaClient();

async function tenant(name: string, slug: string, kind: "AGENCY" | "CLIENT", plan: string, parentId?: string) {
  return db.tenant.upsert({
    where: { slug },
    create: { name, slug, kind, plan, parentId, wrappedDataKey: generateWrappedDataKey(slug), brandName: kind === "AGENCY" ? "GridWorks AI" : null, brandColor: kind === "AGENCY" ? "#0f766e" : null },
    update: {},
  });
}

async function agent(t: { id: string; slug: string; wrappedDataKey: string }, templateId: string, name: string) {
  const existing = await db.agent.findFirst({ where: { tenantId: t.id, templateId } });
  if (existing) return existing;
  const tpl = getTemplate(templateId);
  const a = await db.agent.create({ data: { tenantId: t.id, name, templateId, config: { bookingLink: "https://cal.com/your-team/site-visit" } } });
  await db.knowledgeItem.createMany({ data: tpl.knowledge.map((k) => ({ ...k, tenantId: t.id, agentId: a.id })) });
  await db.channel.create({ data: { tenantId: t.id, agentId: a.id, type: "WEBCHAT", name: "Website chat", credentialsEnc: encryptJson(t, {}) } });
  return a;
}

(async () => {
  const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(password, 12);
  const admin = await db.user.upsert({ where: { email: "admin@agentgrid.local" }, create: { email: "admin@agentgrid.local", name: "Admin", passwordHash: hash }, update: { passwordHash: hash } });

  const agency = await tenant("GridWorks Agency", "gridworks", "AGENCY", "growth");
  const realty = await tenant("Skyline Realty", "skyline-realty", "CLIENT", "growth", agency.id);
  const clinic = await tenant("CarePoint Clinic", "carepoint", "CLIENT", "starter");

  for (const t of [agency, clinic]) {
    await db.membership.upsert({ where: { userId_tenantId: { userId: admin.id, tenantId: t.id } }, create: { userId: admin.id, tenantId: t.id, role: "OWNER" }, update: {} });
  }
  await agent(realty, "real-estate-lead", "Skyline lead qualifier");
  await agent(clinic, "clinic-appointment", "CarePoint front desk");
  await db.tenant.update({ where: { id: clinic.id }, data: { llmEnabled: false } }); // regulated: deterministic only

  console.log(`\nSeeded. Sign in at /login with:\n  email:    admin@agentgrid.local\n  password: ${password}\n`);
  await db.$disconnect();
})();
