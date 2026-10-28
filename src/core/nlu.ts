import type { AgentTemplate, EntityType } from "./templates";

/**
 * Deterministic NLU: intent classification (keyword scoring) + entity extraction.
 * Fast (<1ms), free, explainable – the LLM is reserved for open questions.
 */
export interface NluResult {
  intent: string;
  confidence: number;
  entities: Partial<Record<EntityType, string>>;
  isQuestion: boolean;
}

const GLOBAL_INTENTS: { name: string; patterns: RegExp[] }[] = [
  { name: "opt_out", patterns: [/^\/?stop\b/i, /\bunsubscribe\b/i, /\bdon'?t (message|contact) me\b/i] },
  { name: "forget", patterns: [/\b(delete|erase|forget) (all )?my (data|details|information)\b/i, /^\/forget\b/i] },
  { name: "human", patterns: [/\b(talk|speak|connect|chat) (to|with) (a |an )?(human|person|agent|someone|representative)\b/i, /\breal person\b/i, /^\/human\b/i] },
  { name: "greeting", patterns: [/^(hi|hello|hey|hii+|namaste|good (morning|afternoon|evening))\b/i, /^\/start\b/i] },
  { name: "thanks", patterns: [/^(thanks|thank you|thx|ok thanks)\b/i] },
  { name: "affirm", patterns: [/^(yes|yeah|yep|sure|ok|okay|correct)\b/i] },
  { name: "deny", patterns: [/^(no|nope|not now|nah)\b/i] },
];

const QUESTION_RE = /\?\s*$|^(what|how|when|where|why|which|who|can|do|does|is|are|will|should)\b/i;

export function classify(text: string, template: AgentTemplate): NluResult {
  const t = text.trim();
  const lower = t.toLowerCase();
  const entities = extractEntities(t);
  const isQuestion = QUESTION_RE.test(t);

  for (const g of GLOBAL_INTENTS) {
    if (g.patterns.some((p) => p.test(t))) return { intent: g.name, confidence: 0.95, entities, isQuestion };
  }

  let best = { name: "unknown", score: 0 };
  for (const intent of template.intents) {
    let score = 0;
    for (const kw of intent.keywords) if (lower.includes(kw)) score += kw.includes(" ") ? 2 : 1;
    if (score > best.score) best = { name: intent.name, score };
  }
  if (best.score > 0) {
    return { intent: best.name, confidence: Math.min(0.55 + 0.15 * best.score, 0.95), entities, isQuestion };
  }
  if (isQuestion) return { intent: "question", confidence: 0.6, entities, isQuestion };
  // Short replies carrying an entity are probably slot answers.
  if (Object.keys(entities).length > 0) return { intent: "inform", confidence: 0.7, entities, isQuestion };
  return { intent: "unknown", confidence: 0.3, entities, isQuestion };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?\d{3,5}[\s-]?\d{3,4}[\s-]?\d{0,4}/;
const MONEY_RE =
  /(?:₹|rs\.?|inr|\$|usd|€)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|lakh|lakhs|lac|cr|crore|crores|m|million)?|\d[\d,]*(?:\.\d+)?\s?(?:k|lakh|lakhs|lac|cr|crore|crores|million|rupees|dollars)\b/i;
const DATE_RE =
  /\b(today|tomorrow|day after tomorrow|(?:next |this )?(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i;
const NAME_RE = /\b(?:my name is|i am|i'm|this is|name[:-]?)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i;

export function extractEntities(text: string): Partial<Record<EntityType, string>> {
  const out: Partial<Record<EntityType, string>> = {};
  const email = text.match(EMAIL_RE)?.[0];
  if (email) out.email = email;
  const money = text.match(MONEY_RE)?.[0];
  if (money) out.money = money.trim();
  const date = text.match(DATE_RE)?.[0];
  if (date) out.date = date;
  const phoneCandidate = text.replace(EMAIL_RE, "").match(PHONE_RE)?.[0];
  if (phoneCandidate && phoneCandidate.replace(/\D/g, "").length >= 10 && !money?.includes(phoneCandidate.trim())) {
    out.phone = phoneCandidate.trim();
  }
  const name = text.match(NAME_RE)?.[1];
  if (name) out.name = name;
  const num = text.match(/\b\d+(?:\.\d+)?\b/)?.[0];
  if (num) out.number = num;
  return out;
}

/** Interpret a free reply as a value for the slot we just asked for. */
export function valueForSlot(entity: EntityType, text: string, nlu: NluResult): string | null {
  const t = text.trim();
  switch (entity) {
    case "name": {
      if (nlu.entities.name) return nlu.entities.name;
      // Accept a bare 1–3 word reply ("Ravi Kumar") as a name.
      return /^[\p{L}][\p{L}.'-]*(?:\s[\p{L}][\p{L}.'-]*){0,2}$/u.test(t) ? t : null;
    }
    case "text":
      return t.length >= 2 && t.length <= 200 && !nlu.isQuestion ? t : null;
    case "number":
      return nlu.entities.number ?? null;
    case "money":
      return nlu.entities.money ?? (nlu.entities.number ? nlu.entities.number : null);
    default:
      return nlu.entities[entity] ?? null;
  }
}
