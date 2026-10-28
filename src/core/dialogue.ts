import type { AgentTemplate, WorkflowAction } from "./templates";
import { fill } from "./templates";
import { valueForSlot, type NluResult } from "./nlu";

/**
 * Rule-based dialogue manager (Phase 1 reliability choice): a slot-filling
 * state machine per template. It decides *what* happens; the LLM is only
 * asked to *phrase answers* to open questions.
 */
export interface DialogueState {
  step: "new" | "collecting" | "complete";
  slots: Record<string, string>;
  pending?: string; // slot we last asked for
  lowConfidenceStreak: number;
}

export interface Decision {
  state: DialogueState;
  replies: string[];
  /** Ask the response generator (LLM + knowledge) to answer this question first. */
  answerQuestion?: string;
  handover?: string;
  actions: WorkflowAction[];
  qualified: boolean;
  optOut?: boolean;
  erase?: boolean;
}

export interface DialogueConfig {
  handoverThreshold: number;
  greeting?: string | null;
  links: Record<string, string>;
}

export function initialState(): DialogueState {
  return { step: "new", slots: {}, lowConfidenceStreak: 0 };
}

export function decide(
  template: AgentTemplate,
  prev: DialogueState,
  nlu: NluResult,
  text: string,
  cfg: DialogueConfig,
): Decision {
  const state: DialogueState = { ...prev, slots: { ...prev.slots } };
  const d: Decision = { state, replies: [], actions: [], qualified: state.step === "complete" };

  // 1. Global control intents always win.
  switch (nlu.intent) {
    case "opt_out":
      d.optOut = true;
      d.replies.push("You've been unsubscribed and won't receive further messages. Reply START anytime to chat again.");
      return d;
    case "forget":
      d.erase = true;
      d.replies.push("Done – your conversation history and details have been deleted.");
      return d;
    case "human":
      d.handover = "requested";
      d.replies.push("Sure – connecting you with a team member. They'll reply here shortly.");
      return d;
    case "emergency":
      d.handover = "emergency";
      d.replies.push(
        "This sounds urgent. Please call your local emergency number (112 in India / 911 in the US) right away. I'm alerting our staff now.",
      );
      return d;
  }

  // 2. Slot filling: the pending slot first, then opportunistic entities.
  let filledSomething = false;
  if (state.pending) {
    const def = template.slots.find((s) => s.name === state.pending);
    const v = def ? valueForSlot(def.entity, text, nlu) : null;
    if (def && v) {
      state.slots[def.name] = v;
      state.pending = undefined;
      filledSomething = true;
    }
  }
  for (const def of template.slots) {
    if (state.slots[def.name] || def.entity === "text" || def.entity === "name") continue;
    const v = nlu.entities[def.entity];
    if (v) {
      state.slots[def.name] = v;
      filledSomething = true;
    }
  }
  if (!state.slots.name && nlu.entities.name && template.slots.some((s) => s.name === "name")) {
    state.slots.name = nlu.entities.name;
    filledSomething = true;
  }

  // 3. Open questions go to the response generator (knowledge + LLM).
  const isOpenQuestion = nlu.isQuestion && !filledSomething;
  if (isOpenQuestion) d.answerQuestion = text;

  // 4. Confidence-based handover.
  const understood = filledSomething || isOpenQuestion || nlu.intent !== "unknown";
  if (!understood || nlu.confidence < cfg.handoverThreshold) {
    state.lowConfidenceStreak += 1;
    if (state.lowConfidenceStreak >= 2) {
      d.handover = "low_confidence";
      d.replies.push("I want to make sure you get the right help – connecting you with a team member.");
      return d;
    }
    if (!isOpenQuestion) d.answerQuestion = text; // let the generator try once
  } else {
    state.lowConfidenceStreak = 0;
  }

  const vars = { ...cfg.links, ...state.slots };

  // 5. First contact greeting.
  if (state.step === "new") {
    state.step = "collecting";
    if (!filledSomething && !isOpenQuestion) {
      d.replies.push(cfg.greeting || template.greeting);
      state.pending = template.slots[0]?.name;
      return d;
    }
  }

  if (state.step === "complete") {
    if (!d.answerQuestion) {
      d.replies.push(nlu.intent === "thanks" ? "You're welcome! 😊" : "Anything else I can help you with?");
    }
    return d;
  }

  // 6. Ask the next missing slot, or complete.
  const next = template.slots.find((s) => s.required && !state.slots[s.name]);
  if (next) {
    state.pending = next.name;
    d.replies.push(fill(next.prompt, vars));
  } else {
    state.step = "complete";
    state.pending = undefined;
    d.qualified = true;
    d.replies.push(fill(template.completion.message, vars));
    d.actions.push(...template.completion.actions);
  }
  return d;
}
