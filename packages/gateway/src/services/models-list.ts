/**
 * models.list response shape (Phase 6 extract).
 */

export type ModelsListAuth = {
  models: string[];
  defaultModel?: string | null;
};

export function uniqueModelIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function buildModelsListResponse(
  st: ModelsListAuth,
  fallback = "grok-4.5",
  liveModels: string[] = [],
): { models: string[]; defaultModel: string } {
  const models = uniqueModelIds([...liveModels, ...st.models]);
  return {
    models: models.length ? models : [fallback],
    defaultModel: st.defaultModel ?? models[0] ?? fallback,
  };
}
