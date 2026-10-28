import { describe, expect, it } from "vitest";
import { detectPii, redactPii, redactObject } from "@/lib/pii";

describe("PII", () => {
  it("redacts emails, phones, valid cards", () => {
    const out = redactPii("mail ravi@example.com, call +91 98450 12345, card 4111 1111 1111 1111");
    expect(out).not.toContain("ravi@example.com");
    expect(out).not.toContain("98450");
    expect(out).not.toContain("4111");
    expect(out).toContain("[EMAIL]");
  });
  it("detects PAN and Aadhaar-like numbers", () => {
    const types = detectPii("PAN ABCDE1234F aadhaar 1234 5678 9012").map((m) => m.type);
    expect(types).toContain("PAN");
  });
  it("masks secrets in log objects", () => {
    expect(redactObject({ botToken: "123:abc", nested: { email: "a@b.co" } })).toEqual({ botToken: "[REDACTED]", nested: { email: "[EMAIL]" } });
  });
});

describe("PII phone formats", () => {
  it.each(["+91 98450 12345", "9876543210", "(415) 555-0132", "+1-415-555-0132", "+44 20 7946 0958"])("redacts %s", (p) => {
    expect(redactPii(`call ${p} now`)).toBe("call [PHONE] now");
  });
  it("leaves prices and short numbers alone", () => {
    expect(redactPii("budget 90 lakh, 3 BHK, flat 402")).toBe("budget 90 lakh, 3 BHK, flat 402");
  });
});
