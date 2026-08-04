/**
 * In-memory per-chat-root desktop control grants (Phase 6 extract from TaskRunner).
 *
 * Cap entries so long-lived gateways cannot grow an unbounded grant map from
 * many chat threads. FIFO eviction uses Map insertion order (oldest first).
 */

export type DesktopGrant = {
  granted: boolean;
  displayId: string | null;
};

/** Soft cap on concurrent chat-root grant entries. */
export const DESKTOP_GRANT_MAX_ENTRIES = 512;

/**
 * Root-keyed grant map. Callers resolve taskId → thread root before set/get.
 */
export class DesktopGrantStore {
  private readonly grants = new Map<string, DesktopGrant>();
  private readonly maxEntries: number;

  constructor(maxEntries = DESKTOP_GRANT_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  set(
    rootId: string,
    granted: boolean,
    displayId?: string | null,
  ): DesktopGrant {
    const value: DesktopGrant = {
      granted,
      displayId: displayId === undefined ? null : displayId,
    };
    // Refresh insertion order on update so active roots are not FIFO-evicted first.
    if (this.grants.has(rootId)) {
      this.grants.delete(rootId);
    } else {
      while (this.grants.size >= this.maxEntries) {
        const oldest = this.grants.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.grants.delete(oldest);
      }
    }
    this.grants.set(rootId, value);
    return value;
  }

  get(rootId: string): DesktopGrant {
    return this.grants.get(rootId) ?? { granted: false, displayId: null };
  }

  /** Drop a root (e.g. chat deleted). No-op if missing. */
  delete(rootId: string): boolean {
    return this.grants.delete(rootId);
  }

  /** Test helper. */
  size(): number {
    return this.grants.size;
  }

  clear(): void {
    this.grants.clear();
  }
}
