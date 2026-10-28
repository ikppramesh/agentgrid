import { describe, expect, it } from "vitest";
import { applyGuardrails } from "@/core/guardrails";

describe("guardrails", () => {
  it("honours model handover token", () => {
    expect(applyGuardrails("[[HANDOVER]]", { inputText: "q", sourcesCount: 1 }).handover).toBe(true);
  });
  it("blocks credential requests", () => {
    expect(applyGuardrails("Please share the OTP you received", { inputText: "q", sourcesCount: 1 }).handover).toBe(true);
  });
  it("redacts PII the customer did not provide and strips citations", () => {
    const g = applyGuardrails("Call our manager at 9988776655 [K1]", { inputText: "who do I call?", sourcesCount: 1 });
    expect(g.text).not.toContain("9988776655");
    expect(g.text).not.toContain("[K1]");
    expect(g.flags).toContain("pii_redacted");
  });
  it("flags uncited answers", () => {
    expect(applyGuardrails("We are open 9 to 5.", { inputText: "q", sourcesCount: 2 }).flags).toContain("uncited");
  });
});
