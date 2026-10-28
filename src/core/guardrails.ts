import { detectPii, redactPii } from "@/lib/pii";

/**
 * Output filters applied to every generated reply before it reaches a customer.
 * Flags are stored on the message for model-ops dashboards and evals.
 */
const BLOCKED = [/\bguarantee(d)? returns?\b/i, /\b(otp|one[- ]time password|cvv|pin number)\b/i, /\bfuck|shit|bastard\b/i];
const MAX_LEN = 1200;

export interface GuardrailResult {
  text: string;
  handover: boolean;
  flags: string[];
}

export function applyGuardrails(raw: string, ctx: { inputText: string; sourcesCount: number }): GuardrailResult {
  const flags: string[] = [];
  let text = raw.trim();

  if (text.includes("[[HANDOVER]]") || !text) return { text: "", handover: true, flags: ["model_handover"] };

  if (BLOCKED.some((re) => re.test(text))) return { text: "", handover: true, flags: ["blocked_term"] };

  // PII the customer did not provide must never be emitted (hallucinated or leaked data).
  const inputPii = new Set(detectPii(ctx.inputText).map((m) => m.value));
  if (detectPii(text).some((m) => !inputPii.has(m.value))) {
    text = redactPii(text);
    flags.push("pii_redacted");
  }

  const cited = /\[K\d+\]/.test(text);
  if (ctx.sourcesCount > 0 && !cited) flags.push("uncited");
  if (ctx.sourcesCount === 0) flags.push("no_sources");
  // Customers don't need the citation markers; they're kept in flags/audit.
  text = text.replace(/\s?\[K\d+\]/g, "");

  if (text.length > MAX_LEN) {
    text = text.slice(0, MAX_LEN).replace(/\s+\S*$/, "") + "…";
    flags.push("truncated");
  }
  return { text, handover: false, flags };
}
