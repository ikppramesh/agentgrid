import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";
import { log, errorFields } from "@/lib/logger";
import { redactPii } from "@/lib/pii";
import { PROMPT_VERSION, answerSystemPrompt, answerUserPrompt } from "./prompts";
import { applyGuardrails } from "./guardrails";
import type { Retrieved } from "./knowledge";

export interface AnswerInput {
  question: string;
  sources: Retrieved[];
  history: string[];
  brand: string;
  persona: string;
  restricted: boolean;
  allowLlm: boolean; // tenant setting + global switch + quota
  redactPii: boolean;
}

export interface AnswerOutput {
  text: string;
  handover: boolean;
  source: "llm" | "cache" | "retrieval" | "none";
  model?: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  flags: string[];
}

let client: Anthropic | undefined;
function anthropic() {
  return (client ??= new Anthropic({ maxRetries: 2, timeout: 20_000 }));
}

/**
 * Hybrid response generator:
 *  1. No LLM allowed (tenant compliance, quota, outage) → deterministic retrieval answer or handover.
 *  2. Cached answer for identical question + same knowledge → no API cost.
 *  3. Claude, grounded on retrieved knowledge, then guardrails.
 * Any LLM failure degrades to (1) – the customer always gets a reply.
 */
export async function answer(input: AnswerInput): Promise<AnswerOutput> {
  const started = Date.now();
  const llmOn = input.allowLlm && process.env.LLM_ENABLED !== "false" && !!process.env.ANTHROPIC_API_KEY;
  if (!llmOn) return retrievalOnly(input, started);

  const question = input.redactPii ? redactPii(input.question) : input.question;
  const model = process.env.LLM_MODEL || "claude-opus-5-5";
  const cacheKey =
    "llmcache:" +
    createHash("sha256")
      .update([model, PROMPT_VERSION, input.brand, input.persona, input.sources.map((s) => s.item.id + s.item.content).join("|"), question.toLowerCase().trim()].join("\n"))
      .digest("hex");

  if (input.history.length === 0) {
    const hit = await redis().get(cacheKey);
    if (hit) return { ...JSON.parse(hit), source: "cache", latencyMs: Date.now() - started };
  }

  try {
    const res = await anthropic().beta.messages.create({
      model,
      max_tokens: 1024,
      system: answerSystemPrompt({ brand: input.brand, persona: input.persona, restricted: input.restricted }),
      messages: [
        {
          role: "user",
          content: answerUserPrompt(
            question,
            input.sources.map((s) => s.item),
            input.redactPii ? input.history.map(redactPii) : input.history,
          ),
        },
      ],
      output_config: { effort: (process.env.LLM_EFFORT as "low" | "medium" | "high") || "low" },
      // On a safety decline the API re-runs on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (res.stop_reason === "refusal") {
      return { text: "", handover: true, source: "llm", model, promptVersion: PROMPT_VERSION, latencyMs: Date.now() - started, flags: ["refusal"], inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    }
    const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const g = applyGuardrails(raw, { inputText: input.question, sourcesCount: input.sources.length });
    const out: AnswerOutput = {
      text: g.text,
      handover: g.handover,
      source: "llm",
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      latencyMs: Date.now() - started,
      flags: g.flags,
    };
    if (!g.handover && input.history.length === 0) await redis().set(cacheKey, JSON.stringify(out), "EX", 86_400);
    return out;
  } catch (err) {
    const kind =
      err instanceof Anthropic.RateLimitError
        ? "rate_limited"
        : err instanceof Anthropic.AuthenticationError
          ? "auth"
          : err instanceof Anthropic.BadRequestError
            ? "bad_request"
            : err instanceof Anthropic.APIConnectionError
              ? "connection"
              : err instanceof Anthropic.APIError
                ? `api_${err.status}`
                : "unknown";
    log.error("llm.failed", { kind, ...errorFields(err) });
    const fb = retrievalOnly(input, started);
    fb.flags.push(`llm_error:${kind}`);
    return fb;
  }
}

function retrievalOnly(input: AnswerInput, started: number): AnswerOutput {
  const top = input.sources[0];
  if (top && top.score >= 1.0) {
    return { text: top.item.content, handover: false, source: "retrieval", promptVersion: "retrieval.v1", latencyMs: Date.now() - started, flags: ["deterministic"] };
  }
  return { text: "", handover: true, source: "none", promptVersion: "retrieval.v1", latencyMs: Date.now() - started, flags: ["no_answer"] };
}
