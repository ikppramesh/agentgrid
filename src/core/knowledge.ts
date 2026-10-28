import type { KnowledgeItem } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Knowledge retrieval without a vector DB: BM25-style keyword scoring over the
 * tenant's knowledge items in Postgres. The interface (`retrieve`) is what a
 * future embeddings/RAG backend will implement (Phase 2: pgvector / managed index).
 */
const STOP = new Set("a an the is are was were be to of and or in on at for with do does can i you we my your it this that what how when where which who".split(" "));

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export interface Retrieved {
  item: Pick<KnowledgeItem, "id" | "title" | "content" | "tags">;
  score: number;
}

export function rank(query: string, items: Retrieved["item"][], k = 3): Retrieved[] {
  const q = tokenize(query);
  if (!q.length) return [];
  const docs = items.map((item) => ({ item, toks: tokenize(`${item.title} ${item.title} ${item.tags.join(" ")} ${item.content}`) }));
  const avgLen = docs.reduce((n, d) => n + d.toks.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d.toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  return docs
    .map(({ item, toks }) => {
      let score = 0;
      for (const w of q) {
        const tf = toks.filter((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1)))).length;
        if (!tf) continue;
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (toks.length / avgLen)));
      }
      return { item, score };
    })
    .filter((r) => r.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function retrieve(tenantId: string, agentId: string, query: string, k = 3) {
  const items = await db.knowledgeItem.findMany({
    where: { tenantId, OR: [{ agentId }, { agentId: null }] },
    select: { id: true, title: true, content: true, tags: true },
    take: 500,
  });
  return rank(query, items, k);
}
