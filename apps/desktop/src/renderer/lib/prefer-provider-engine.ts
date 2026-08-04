/**
 * Pure helpers for settings.preferProviderEngine (AgentProvider dual-path opt-in).
 * Default remains false — no silent product cutover.
 */

/** Coerce settings.get field into a boolean (default false). */
export function preferProviderEngineFromSettings(
  value: unknown,
): boolean {
  return value === true;
}

/** Payload for settings.set when toggling the opt-in. */
export function preferProviderEngineSetPayload(
  enabled: boolean,
): { preferProviderEngine: boolean } {
  return { preferProviderEngine: enabled };
}
