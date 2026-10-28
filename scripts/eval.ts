/**
 * Offline evaluation of the deterministic conversational stack (NLU + dialogue
 * manager) against scripted conversations. Runs in CI as a quality gate.
 *
 *   npm run eval                 # deterministic suite
 *   npm run eval -- --live       # also grade LLM answers for knowledge questions (needs ANTHROPIC_API_KEY + REDIS_URL)
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { classify } from "../src/core/nlu";
import { decide, initialState, type DialogueState } from "../src/core/dialogue";
import { getTemplate } from "../src/core/templates";
import { rank } from "../src/core/knowledge";
import { PROMPT_VERSION } from "../src/core/prompts";

interface Turn {
  user: string;
  intent?: string;
  slots?: Record<string, string>;
  handover?: string;
  qualified?: boolean;
  optOut?: boolean;
  erase?: boolean;
  answerQuestion?: boolean;
  replyContains?: string;
}
interface Case {
  id: string;
  template: string;
  turns: Turn[];
}

const THRESHOLD = Number(process.env.EVAL_MIN_PASS ?? 0.9);
const live = process.argv.includes("--live");
const cases: Case[] = readFileSync("evals/cases.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

let checks = 0;
let passed = 0;
const failures: string[] = [];
const liveQuestions: { question: string; template: string }[] = [];

function check(ok: boolean, label: string) {
  checks++;
  if (ok) passed++;
  else failures.push(label);
}

for (const c of cases) {
  const template = getTemplate(c.template);
  let state: DialogueState = initialState();
  c.turns.forEach((t, i) => {
    const nlu = classify(t.user, template);
    const d = decide(template, state, nlu, t.user, { handoverThreshold: 0.45, links: { bookingLink: "https://cal.example/x", paymentLink: "https://pay.example/x" } });
    const at = `${c.id}#${i + 1} "${t.user}"`;
    if (t.intent) check(nlu.intent === t.intent, `${at}: intent ${nlu.intent} ≠ ${t.intent}`);
    for (const [k, v] of Object.entries(t.slots ?? {})) check(d.state.slots[k] === v, `${at}: slot ${k}=${d.state.slots[k]} ≠ ${v}`);
    if (t.handover) check(d.handover === t.handover, `${at}: handover ${d.handover} ≠ ${t.handover}`);
    if (t.qualified !== undefined) check(d.qualified === t.qualified, `${at}: qualified ${d.qualified}`);
    if (t.optOut) check(!!d.optOut, `${at}: expected opt-out`);
    if (t.erase) check(!!d.erase, `${at}: expected erase`);
    if (t.answerQuestion) {
      check(!!d.answerQuestion, `${at}: expected question routed to generator`);
      const hits = rank(t.user, template.knowledge.map((k, j) => ({ id: String(j), ...k })));
      check(hits.length > 0, `${at}: no knowledge retrieved`);
      liveQuestions.push({ question: t.user, template: c.template });
    }
    if (t.replyContains) check(d.replies.join(" ").toLowerCase().includes(t.replyContains.toLowerCase()), `${at}: reply lacks "${t.replyContains}"`);
    state = d.state;
  });
}

async function runLive() {
  const { answer } = await import("../src/core/llm");
  for (const q of liveQuestions) {
    const template = getTemplate(q.template);
    const sources = rank(q.question, template.knowledge.map((k, j) => ({ id: String(j), ...k })));
    const a = await answer({ question: q.question, sources, history: [], brand: "Eval Co", persona: "", restricted: template.restricted, allowLlm: true, redactPii: true });
    check(!a.handover && a.text.length > 0, `live "${q.question}": no answer (${a.flags.join(",")})`);
    check(!a.flags.includes("uncited"), `live "${q.question}": answer not grounded in sources`);
    console.log(`  live: "${q.question}" → ${a.text} [${a.source}, ${a.latencyMs}ms, flags=${a.flags.join(",") || "none"}]`);
  }
}

(async () => {
  if (live) await runLive();
  const rate = checks ? passed / checks : 0;
  const report = { at: new Date().toISOString(), promptVersion: PROMPT_VERSION, live, cases: cases.length, checks, passed, rate, failures };
  mkdirSync("evals/results", { recursive: true });
  writeFileSync(`evals/results/${report.at.replace(/[:.]/g, "-")}.json`, JSON.stringify(report, null, 2));
  console.log(`\nEval: ${passed}/${checks} checks passed (${(rate * 100).toFixed(1)}%) across ${cases.length} conversations`);
  for (const f of failures) console.log("  ✗ " + f);
  if (rate < THRESHOLD) {
    console.error(`FAIL: pass rate below ${THRESHOLD * 100}%`);
    process.exit(1);
  }
  process.exit(0);
})();
