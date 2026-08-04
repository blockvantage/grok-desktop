/**
 * Suspend/resume gate: pause scheduler dispatch on sleep, refresh auth
 * BEFORE releasing queued work on wake (prevents stale-token task failures).
 */
export type PowerState = "active" | "suspended";

export class PowerStateGate {
  private current: PowerState = "active";

  constructor(
    private hooks: {
      pauseDispatch: () => void;
      resumeDispatch: () => void;
      refreshAuth: () => Promise<void>;
    },
  ) {}

  get state(): PowerState {
    return this.current;
  }

  async setState(next: PowerState): Promise<void> {
    if (next === this.current) return;
    this.current = next;
    if (next === "suspended") {
      this.hooks.pauseDispatch();
      return;
    }
    try {
      await this.hooks.refreshAuth();
    } catch {
      // Wake must never wedge dispatch; auth errors surface via needs_reauth path.
    }
    this.hooks.resumeDispatch();
  }
}
