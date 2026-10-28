import { describe, expect, it } from "vitest";
import { classify, extractEntities } from "@/core/nlu";
import { decide, initialState } from "@/core/dialogue";
import { getTemplate } from "@/core/templates";
import { rank } from "@/core/knowledge";

const re = getTemplate("real-estate-lead");
const cfg = { handoverThreshold: 0.45, links: { bookingLink: "https://cal/x", paymentLink: "" } };

function run(template = re, ...msgs: string[]) {
  let state = initialState();
  let last;
  for (const m of msgs) {
    last = decide(template, state, classify(m, template), m, cfg);
    state = last.state;
  }
  return last!;
}

describe("NLU", () => {
  it("extracts entities", () => {
    expect(extractEntities("budget 1.2 crore, call +91 98450 12345")).toMatchObject({ money: "1.2 crore", phone: "+91 98450 12345" });
    expect(extractEntities("my name is Anita Rao").name).toBe("Anita Rao");
    expect(extractEntities("tomorrow please").date).toBe("tomorrow");
  });
  it("global intents win", () => {
    expect(classify("STOP", re).intent).toBe("opt_out");
    expect(classify("can I talk to a human?", re).intent).toBe("human");
  });
});

describe("dialogue manager", () => {
  it("qualifies a lead end-to-end and triggers CRM workflow", () => {
    const d = run(re, "hi", "Ravi Kumar", "9876543210", "Whitefield", "90 lakh", "3 months");
    expect(d.qualified).toBe(true);
    expect(d.actions.map((a) => a.type)).toContain("crm.upsert_lead");
    expect(d.replies.join(" ")).toContain("https://cal/x");
  });
  it("routes open questions to the generator without losing the pending slot", () => {
    const d = run(re, "hi", "Do you help with home loans?");
    expect(d.answerQuestion).toBeTruthy();
    expect(d.state.pending).toBe("name");
  });
  it("hands over after repeated low confidence", () => {
    expect(run(re, "hi", "asdf qwer", "zzzz").handover).toBe("low_confidence");
  });
  it("escalates emergencies in the clinic template", () => {
    expect(run(getTemplate("clinic-appointment"), "my mother has chest pain").handover).toBe("emergency");
  });
});

describe("knowledge retrieval", () => {
  it("ranks relevant items first", () => {
    const items = re.knowledge.map((k, i) => ({ id: String(i), ...k }));
    expect(rank("do you help with a home loan?", items)[0].item.title).toBe("Home loan assistance");
    expect(rank("xyz", items)).toHaveLength(0);
  });
});
