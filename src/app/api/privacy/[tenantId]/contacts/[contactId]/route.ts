import { authorize } from "@/lib/auth/access";
import { exportContact, eraseContact } from "@/core/engine";
import { audit } from "@/lib/audit";
import { handleError, json, HttpError } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ tenantId: string; contactId: string }> };

/** Data subject access request (GDPR Art. 15 / DPDP s.11): JSON export. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { tenantId, contactId } = await params;
    const { tenant, session } = await authorize(tenantId, "pii:read");
    const data = await exportContact(tenant, contactId);
    if (!data) throw new HttpError(404, "Not found");
    await audit({ tenantId, actorId: session.userId, action: "privacy.export", target: contactId });
    return json(data, 200, { "content-disposition": `attachment; filename="contact-${contactId}.json"` });
  } catch (err) {
    return handleError(err);
  }
}

/** Right to erasure (GDPR Art. 17). */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { tenantId, contactId } = await params;
    const { session } = await authorize(tenantId, "privacy:erase");
    if (!(await eraseContact(tenantId, contactId, session.userId))) throw new HttpError(404, "Not found");
    return json({ erased: true });
  } catch (err) {
    return handleError(err);
  }
}
