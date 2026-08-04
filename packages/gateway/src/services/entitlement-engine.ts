/**
 * Last-inference entitlement boundary (Task 8).
 *
 * Wraps an EngineAdapter so every provider run re-checks `grok_operation`
 * before real work. Prefer constructor injection of EntitlementGuard so tests
 * can pass fakes; do not rely on a process-global singleton.
 */

import type { EngineAdapter, EngineRunOptions } from "../engine-types.js";
import type { EntitlementGuard } from "./entitlement-guard.js";

/** Default action string for engine.run (entrypoint matrix: provider_inference). */
export const PROVIDER_INFERENCE_ACTION = "provider_inference" as const;

export type EntitlementGuardedEngineOptions = {
  /** Guard consulted before every run. Required. */
  guard: EntitlementGuard;
  /**
   * Action label for assertCapability (diagnostics / receipts).
   * Defaults to `provider_inference`.
   */
  action?: string;
};

/**
 * EngineAdapter that refuses to run when the entitlement lease is not valid
 * for Grok-backed work. Cancel remains ungated (recovery / local manage).
 */
export class EntitlementGuardedEngine implements EngineAdapter {
  private readonly guard: EntitlementGuard;
  private readonly action: string;

  constructor(
    private readonly inner: EngineAdapter,
    options: EntitlementGuardedEngineOptions,
  ) {
    this.guard = options.guard;
    this.action = options.action ?? PROVIDER_INFERENCE_ACTION;
  }

  get executesOwnTools(): boolean {
    return this.inner.executesOwnTools;
  }

  async run(options: EngineRunOptions): Promise<void> {
    await this.guard.assertCapability("grok_operation", this.action);
    return this.inner.run(options);
  }

  async cancel(taskId: string): Promise<void> {
    return this.inner.cancel(taskId);
  }
}

/**
 * Wrap `engine` when a guard is provided; otherwise return the engine unchanged
 * so composition roots and unit tests without entitlements stay unblocked.
 */
export function wrapEngineWithEntitlementGuard(
  engine: EngineAdapter,
  guard: EntitlementGuard | null | undefined,
  action: string = PROVIDER_INFERENCE_ACTION,
): EngineAdapter {
  if (!guard) return engine;
  return new EntitlementGuardedEngine(engine, { guard, action });
}
