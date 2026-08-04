/**
 * Type-only bridge for the legacy EngineAdapter surface.
 * Domain modules import from here; concrete Grok construction lives in
 * engine-composition.ts (composition root only).
 */
export type {
  EngineAdapter,
  EngineRunOptions,
  NormalizedEngineEvent,
} from "@grokdesk/engine-grok";
