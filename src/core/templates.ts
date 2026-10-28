/**
 * Industry agent templates: intents, qualification slots, completion
 * workflow and starter knowledge. Tenants pick one and override via Agent.config.
 */
export type EntityType = "name" | "email" | "phone" | "money" | "date" | "text" | "number";

export interface SlotDef {
  name: string;
  entity: EntityType;
  prompt: string;
  required: boolean;
}

export type WorkflowAction =
  | { type: "crm.upsert_lead" }
  | { type: "webhook.emit"; event: string }
  | { type: "notify.handover" };

export interface AgentTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  /** Sensitive domains: the LLM may only restate knowledge, never improvise. */
  restricted: boolean;
  greeting: string;
  intents: { name: string; keywords: string[] }[];
  slots: SlotDef[];
  completion: { message: string; actions: WorkflowAction[] };
  knowledge: { title: string; content: string; tags: string[] }[];
}

export const TEMPLATES: AgentTemplate[] = [
  {
    id: "real-estate-lead",
    name: "Real-estate lead qualifier",
    industry: "Real estate",
    description: "Qualifies buyers (budget, location, timeline), books a site visit and pushes the lead to CRM.",
    restricted: false,
    greeting: "Hi! 👋 I can help you find the right property. May I know your name?",
    intents: [
      { name: "buy", keywords: ["buy", "purchase", "looking for", "flat", "apartment", "villa", "plot", "house", "bhk"] },
      { name: "rent", keywords: ["rent", "lease", "rental"] },
      { name: "site_visit", keywords: ["visit", "site visit", "see the property", "schedule", "book"] },
      { name: "pricing", keywords: ["price", "cost", "rate", "how much", "emi", "loan"] },
    ],
    slots: [
      { name: "name", entity: "name", prompt: "May I know your name?", required: true },
      { name: "phone", entity: "phone", prompt: "Thanks {{name}}! What's the best phone number to reach you?", required: true },
      { name: "location", entity: "text", prompt: "Which area or locality are you interested in?", required: true },
      { name: "budget", entity: "money", prompt: "What's your approximate budget? (e.g. 80 lakh, 1.2 crore)", required: true },
      { name: "timeline", entity: "text", prompt: "When are you planning to buy? (this month / 3 months / 6+ months)", required: true },
    ],
    completion: {
      message:
        "Great, {{name}}! You're all set. Our advisor will call you on {{phone}} shortly. You can also pick a site-visit slot here: {{bookingLink}}",
      actions: [{ type: "crm.upsert_lead" }, { type: "webhook.emit", event: "lead.qualified" }],
    },
    knowledge: [
      { title: "Home loan assistance", content: "We partner with major banks for home loans and can help with paperwork and pre-approval.", tags: ["loan", "emi", "bank"] },
      { title: "Site visits", content: "Site visits run daily 10am–6pm. Free pick-up is available within city limits for confirmed visits.", tags: ["visit", "pickup", "timing"] },
    ],
  },
  {
    id: "clinic-appointment",
    name: "Clinic appointment booking",
    industry: "Healthcare",
    description: "Books appointments and answers clinic FAQs. Restricted mode: never gives medical advice.",
    restricted: true,
    greeting: "Hello! I can help you book an appointment. What's your name?",
    intents: [
      { name: "book", keywords: ["appointment", "book", "consult", "doctor", "slot", "schedule"] },
      { name: "timings", keywords: ["timing", "open", "hours", "sunday", "close"] },
      { name: "emergency", keywords: ["emergency", "chest pain", "bleeding", "unconscious", "can't breathe", "suicide"] },
    ],
    slots: [
      { name: "name", entity: "name", prompt: "What's the patient's name?", required: true },
      { name: "phone", entity: "phone", prompt: "Please share a contact number.", required: true },
      { name: "date", entity: "date", prompt: "Which day would you prefer? (e.g. tomorrow, Monday, 12/11)", required: true },
      { name: "department", entity: "text", prompt: "Which department or doctor would you like to see?", required: true },
    ],
    completion: {
      message:
        "Thank you, {{name}}. We've noted your request for {{department}} on {{date}}. Please confirm a time here: {{bookingLink}}. For emergencies call your local emergency number immediately.",
      actions: [{ type: "crm.upsert_lead" }, { type: "webhook.emit", event: "appointment.requested" }],
    },
    knowledge: [
      { title: "Clinic hours", content: "The clinic is open Monday–Saturday, 9am–8pm. Closed on Sundays and public holidays.", tags: ["timings", "hours"] },
      { title: "What to bring", content: "Please bring a photo ID, previous prescriptions and any recent test reports.", tags: ["documents", "visit"] },
    ],
  },
  {
    id: "ecommerce-assistant",
    name: "E-commerce shopping assistant",
    industry: "Retail / D2C",
    description: "Recommends products from the catalog, answers order/returns FAQs and shares payment links.",
    restricted: false,
    greeting: "Hi! I'm your shopping assistant. What are you looking for today?",
    intents: [
      { name: "recommend", keywords: ["recommend", "suggest", "looking for", "best", "gift", "show me"] },
      { name: "order_status", keywords: ["order", "track", "delivery", "shipped", "where is"] },
      { name: "returns", keywords: ["return", "refund", "exchange", "replace"] },
      { name: "pay", keywords: ["pay", "buy now", "checkout", "payment link"] },
    ],
    slots: [
      { name: "category", entity: "text", prompt: "Which product category are you interested in?", required: true },
      { name: "budget", entity: "money", prompt: "What's your budget?", required: true },
      { name: "email", entity: "email", prompt: "Share your email and I'll send the picks + an exclusive code.", required: false },
    ],
    completion: {
      message: "Thanks! I've noted {{category}} under {{budget}}. Ask me anything about products, or checkout here: {{paymentLink}}",
      actions: [{ type: "crm.upsert_lead" }, { type: "webhook.emit", event: "lead.captured" }],
    },
    knowledge: [
      { title: "Returns policy", content: "Unused items can be returned within 7 days of delivery for a full refund to the original payment method.", tags: ["returns", "refund"] },
      { title: "Shipping", content: "Orders ship within 24 hours. Standard delivery takes 3–5 business days; express 1–2 days.", tags: ["delivery", "shipping"] },
    ],
  },
];

export function getTemplate(id: string): AgentTemplate {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template ${id}`);
  return t;
}

export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}
