import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, generateWrappedDataKey, signPayload, verifySignature } from "@/lib/crypto";

describe("envelope encryption", () => {
  const t = { slug: "acme", wrappedDataKey: generateWrappedDataKey("acme") };
  it("round-trips tenant data", () => {
    const enc = encryptJson(t, { botToken: "secret" });
    expect(enc).not.toContain("secret");
    expect(decryptJson(t, enc)).toEqual({ botToken: "secret" });
  });
  it("cannot be decrypted with another tenant's key", () => {
    const other = { slug: "evil", wrappedDataKey: generateWrappedDataKey("evil") };
    expect(() => decryptJson(other, encryptJson(t, { a: 1 }))).toThrow();
  });
  it("rejects a key wrapped for a different tenant slug (AAD binding)", () => {
    expect(() => decryptJson({ slug: "evil", wrappedDataKey: t.wrappedDataKey }, encryptJson(t, {}))).toThrow();
  });
});

describe("webhook signatures", () => {
  it("verifies valid and rejects tampered / stale", () => {
    const body = JSON.stringify({ text: "hi" });
    const now = 1_800_000_000;
    const sig = signPayload("s3cret-s3cret-s3cret", body, now);
    expect(verifySignature("s3cret-s3cret-s3cret", body, sig, 300, now)).toBe(true);
    expect(verifySignature("s3cret-s3cret-s3cret", body + " ", sig, 300, now)).toBe(false);
    expect(verifySignature("s3cret-s3cret-s3cret", body, sig, 300, now + 301)).toBe(false);
    expect(verifySignature("s3cret-s3cret-s3cret", body, null)).toBe(false);
  });
});
