import { z } from "zod";
import { db } from "@/lib/db";
import { decryptJson, type TenantKeyRef } from "@/lib/crypto";
import { postSigned } from "@/channels/webhook";

/** Integration configs (stored encrypted per tenant). */
export const integrationSchemas = {
  hubspot: z.object({ accessToken: z.string().min(10) }),
  crm_webhook: z.object({ url: z.string().url(), secret: z.string().min(16) }),
  outbound_webhook: z.object({ url: z.string().url(), secret: z.string().min(16), events: z.array(z.string()).default(["*"]) }),
};

export type IntegrationKind = keyof typeof integrationSchemas;

export async function loadIntegrations<K extends IntegrationKind>(tenant: TenantKeyRef & { id: string }, kind: K) {
  const rows = await db.integration.findMany({ where: { tenantId: tenant.id, kind, active: true } });
  return rows.map((r) => integrationSchemas[kind].parse(decryptJson(tenant, r.configEnc)) as z.infer<(typeof integrationSchemas)[K]>);
}

export interface Lead {
  name?: string;
  email?: string;
  phone?: string;
  fields: Record<string, string>;
  conversationId: string;
  agentName: string;
}

/** HubSpot CRM v3: create contact, or update by email if it exists. */
export async function hubspotUpsert(token: string, lead: Lead) {
  const [firstname, ...rest] = (lead.name ?? "").split(" ");
  const properties: Record<string, string> = {
    firstname: firstname ?? "",
    lastname: rest.join(" "),
    phone: lead.phone ?? "",
    hs_lead_status: "NEW",
    message: Object.entries(lead.fields).map(([k, v]) => `${k}: ${v}`).join("\n"),
  };
  if (lead.email) properties.email = lead.email;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({ properties }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 409 && lead.email) {
    const upd = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(lead.email)}?idProperty=email`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ properties }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!upd.ok) throw new Error(`hubspot update ${upd.status}`);
    return;
  }
  if (!res.ok) throw new Error(`hubspot create ${res.status}`);
}

export async function crmWebhook(cfg: { url: string; secret: string }, lead: Lead) {
  await postSigned(cfg.url, cfg.secret, { type: "lead.upsert", lead });
}
