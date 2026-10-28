/**
 * PII detection & redaction. Applied before text is logged, stored in plain
 * form, exported for training, or sent to a cloud LLM.
 */
const PATTERNS: { type: string; re: RegExp }[] = [
  { type: "EMAIL", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g },
  { type: "AADHAAR", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  { type: "PAN", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // 10–14 digits with optional +country code and space/dash/paren grouping (IN, US, EU formats).
  { type: "PHONE", re: /(?<![\w+])(?:\+\d{1,3}[\s-]?)?\(?\d{2,5}\)?(?:[\s-]?\d){6,10}(?!\w)/g },
  { type: "IP", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

export interface PiiMatch {
  type: string;
  value: string;
}

export function detectPii(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];
  for (const { type, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (type === "CARD" && !luhn(m[0])) continue;
      found.push({ type, value: m[0] });
    }
  }
  return found;
}

export function redactPii(text: string): string {
  let out = text;
  for (const { type, re } of PATTERNS) {
    out = out.replace(re, (match) => (type === "CARD" && !luhn(match) ? match : `[${type}]`));
  }
  return out;
}

function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Deep-redact string values in a log/meta object. */
export function redactObject<T>(value: T): T {
  if (typeof value === "string") return redactPii(value) as T;
  if (Array.isArray(value)) return value.map(redactObject) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|secret|password|authorization|key/i.test(k) ? "[REDACTED]" : redactObject(v);
    }
    return out as T;
  }
  return value;
}
