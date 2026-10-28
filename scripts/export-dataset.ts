/**
 * Export a PII-redacted NLU dataset (JSONL) for retraining / retrieval tuning.
 * Human corrections (labeledIntent) override model predictions.
 *   npm run dataset:export -- --tenant <tenantId> [--days 90]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { redactPii } from "../src/lib/pii";

const db = new PrismaClient();
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const tenantId = arg("--tenant");
  const days = Number(arg("--days") ?? 90);
  const rows = await db.message.findMany({
    where: { direction: "INBOUND", ...(tenantId ? { tenantId } : {}), createdAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    select: { text: true, intent: true, labeledIntent: true, confidence: true, tenantId: true },
  });
  mkdirSync("datasets", { recursive: true });
  const file = `datasets/nlu-${new Date().toISOString().slice(0, 10)}.jsonl`;
  // `text` is already redacted at write time; redact again defensively.
  writeFileSync(
    file,
    rows
      .map((r) => JSON.stringify({ text: redactPii(r.text), label: r.labeledIntent ?? r.intent, predicted: r.intent, confidence: r.confidence, gold: !!r.labeledIntent }))
      .join("\n"),
  );
  console.log(`Wrote ${rows.length} examples (${rows.filter((r) => r.labeledIntent).length} human-labeled) → ${file}`);
  await db.$disconnect();
})();
