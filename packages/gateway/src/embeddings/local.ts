/** Deterministic bag-of-words embedder for local memory ranking (no native deps). */
export interface Embedder {
  embed(text: string): number[];
  similarity(a: number[], b: number[]): number;
}

export class LocalEmbedder implements Embedder {
  embed(text: string): number[] {
    const tokens = tokenize(text);
    const dim = 256;
    const vec = new Array<number>(dim).fill(0);
    for (const t of tokens) {
      const h = hash(t) % dim;
      vec[h]! += 1;
    }
    // L2 normalize
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    return vec.map((v) => v / norm);
  }

  similarity(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
    return dot;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 1);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
