import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption.
 *   MASTER_KEY (KEK, from env / KMS) wraps a random per-tenant data key (DEK);
 *   DEKs encrypt tenant secrets and raw PII with AES-256-GCM.
 * Rotating MASTER_KEY only requires re-wrapping DEKs, not re-encrypting data.
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url)
 */
const ALG = "aes-256-gcm";

function masterKey(): Buffer {
  const raw = process.env.MASTER_KEY;
  if (!raw) throw new Error("MASTER_KEY not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MASTER_KEY must decode to 32 bytes");
  return key;
}

export function encryptWithKey(key: Buffer, plaintext: string, aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptWithKey(key: Buffer, payload: string, aad = ""): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv(ALG, key, Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Create a new tenant data key, returned wrapped by the master key. */
export function generateWrappedDataKey(tenantSlug: string): string {
  return encryptWithKey(masterKey(), randomBytes(32).toString("base64"), `tenant:${tenantSlug}`);
}

export function unwrapDataKey(wrapped: string, tenantSlug: string): Buffer {
  return Buffer.from(decryptWithKey(masterKey(), wrapped, `tenant:${tenantSlug}`), "base64");
}

export interface TenantKeyRef {
  slug: string;
  wrappedDataKey: string;
}

export function encryptForTenant(t: TenantKeyRef, plaintext: string): string {
  return encryptWithKey(unwrapDataKey(t.wrappedDataKey, t.slug), plaintext, t.slug);
}

export function decryptForTenant(t: TenantKeyRef, payload: string): string {
  return decryptWithKey(unwrapDataKey(t.wrappedDataKey, t.slug), payload, t.slug);
}

export function encryptJson(t: TenantKeyRef, value: unknown): string {
  return encryptForTenant(t, JSON.stringify(value));
}

export function decryptJson<T>(t: TenantKeyRef, payload: string): T {
  return JSON.parse(decryptForTenant(t, payload)) as T;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Webhook signatures (Stripe-style): header `t=<unix>,v1=<hex hmac(t.body)>`.
 * Timestamp tolerance blocks replay.
 */
export function signPayload(secret: string, body: string, now = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
  return `t=${now},v1=${sig}`;
}

export function verifySignature(
  secret: string,
  body: string,
  header: string | null,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(now - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return safeEqual(expected, parts.v1);
}
