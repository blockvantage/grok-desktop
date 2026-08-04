/**
 * models.list response shape (Phase 6 extract).
 */

export type ModelsListAuth = {
  models: string[];
  defaultModel?: string | null;
};

export function buildModelsListResponse(
  st: ModelsListAuth,
  fallback = "grok-4.5",
): { models: string[]; defaultModel: string } {
  return {
    models: st.models.length ? st.models : [fallback],
    defaultModel: st.defaultModel ?? fallback,
  };
}
