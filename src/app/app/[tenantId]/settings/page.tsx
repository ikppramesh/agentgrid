import { authorizePage } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { planFor } from "@/lib/plans";
import { consumeReveal } from "@/lib/reveal";
import { env } from "@/lib/env";
import {
  updateSettingsAction,
  addIntegrationAction,
  removeIntegrationAction,
  saveSsoAction,
  inviteMemberAction,
  removeMemberAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function Settings({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ reveal?: string }> }) {
  const { tenantId } = await params;
  const { reveal } = await searchParams;
  const { tenant } = await authorizePage(tenantId, "tenant:manage");
  const plan = planFor(tenant.plan);
  const [integrations, sso, members] = await Promise.all([
    db.integration.findMany({ where: { tenantId } }),
    db.ssoConfig.findUnique({ where: { tenantId } }),
    db.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);
  const invited = await consumeReveal(tenantId, reveal);

  return (
    <>
      <h1>Settings</h1>
      {invited && (
        <div className="alert success">
          {invited.email} added.{" "}
          {invited.tempPassword ? <>Temporary password (shown once): <code>{invited.tempPassword}</code></> : "They already had an account."}
        </div>
      )}
      <div className="split">
        <div className="card">
          <h3>Branding &amp; compliance</h3>
          <form className="stack" action={updateSettingsAction.bind(null, tenantId)}>
            <label>Brand name {!plan.whiteLabel && !tenant.parentId && <span className="small muted">(white-label needs Growth+)</span>}<input name="brandName" defaultValue={tenant.brandName ?? ""} /></label>
            <label>Logo URL (https)<input name="brandLogoUrl" defaultValue={tenant.brandLogoUrl ?? ""} /></label>
            <label>Brand colour<input name="brandColor" defaultValue={tenant.brandColor ?? ""} placeholder="#4f46e5" /></label>
            <label>Data retention (days)<input name="retentionDays" type="number" min={7} max={3650} defaultValue={tenant.retentionDays} /></label>
            <label className="row"><input type="checkbox" name="llmEnabled" defaultChecked={tenant.llmEnabled} /> Allow cloud LLM (off = deterministic only, for HIPAA/regulated tenants)</label>
            <label className="row"><input type="checkbox" name="piiRedaction" defaultChecked={tenant.piiRedaction} /> Redact PII in stored text, analytics and LLM prompts</label>
            <button>Save</button>
          </form>
        </div>
        <div className="card">
          <h3>Single sign-on (OIDC)</h3>
          {plan.sso ? (
            <form className="stack" action={saveSsoAction.bind(null, tenantId)}>
              <label>Issuer URL<input name="issuer" defaultValue={sso?.issuer} placeholder="https://accounts.google.com" required /></label>
              <label>Client ID<input name="clientId" defaultValue={sso?.clientId} required /></label>
              <label>Client secret<input name="clientSecret" type="password" placeholder={sso ? "•••••• (re-enter to change)" : ""} required autoComplete="off" /></label>
              <label>Allowed email domains<input name="allowedDomains" defaultValue={sso?.allowedDomains.join(", ")} placeholder="acme.com" /></label>
              <label>Default role for new users
                <select name="defaultRole" defaultValue={sso?.defaultRole ?? "VIEWER"}><option>VIEWER</option><option>OPERATOR</option><option>ADMIN</option></select>
              </label>
              <label className="row"><input type="checkbox" name="enforced" defaultChecked={sso?.enforced} /> Enforce SSO (disable password login)</label>
              <div className="small muted">Redirect URI: <code>{env().APP_URL}/api/auth/sso/callback</code> · Org ID: <code>{tenant.slug}</code></div>
              <button>Save SSO</button>
            </form>
          ) : (
            <p className="muted">SSO is available on Growth and Enterprise plans.</p>
          )}
        </div>
      </div>

      <h2>Integrations</h2>
      <div className="split">
        <table>
          <tbody>
            {integrations.map((i) => (
              <tr key={i.id}><td>{i.kind}</td><td className="small muted">{i.createdAt.toLocaleDateString()}</td>
                <td><form action={removeIntegrationAction.bind(null, tenantId, i.id)}><button className="ghost">Remove</button></form></td></tr>
            ))}
            {!integrations.length && <tr><td className="muted">None yet.</td></tr>}
          </tbody>
        </table>
        <div className="card">
          <form className="stack" action={addIntegrationAction.bind(null, tenantId)}>
            <label>Type
              <select name="kind"><option value="hubspot">HubSpot CRM</option><option value="crm_webhook">CRM webhook (Salesforce/Zoho via middleware)</option><option value="outbound_webhook">Event webhook (handover, leads → Slack/WhatsApp/n8n)</option></select>
            </label>
            <label>HubSpot private-app token<input name="accessToken" type="password" autoComplete="off" /></label>
            <label>Webhook URL<input name="url" type="url" /></label>
            <label>Signing secret (blank = generate)<input name="secret" autoComplete="off" /></label>
            <label>Events (event webhook)<input name="events" placeholder="* or lead.qualified,conversation.handover" /></label>
            <button>Add</button>
          </form>
        </div>
      </div>

      <h2>Members</h2>
      <div className="split">
        <table>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}><td>{m.user.email}</td><td>{m.role}</td>
                <td><form action={removeMemberAction.bind(null, tenantId, m.userId)}><button className="ghost">Remove</button></form></td></tr>
            ))}
          </tbody>
        </table>
        <div className="card">
          <form className="stack" action={inviteMemberAction.bind(null, tenantId)}>
            <label>Email<input name="email" type="email" required /></label>
            <label>Role<select name="role"><option>OPERATOR</option><option>VIEWER</option><option>ADMIN</option><option>OWNER</option></select></label>
            <button>Invite</button>
          </form>
        </div>
      </div>
    </>
  );
}
