/**
 * Capability discovery — surface wow coworker features the user has not tried.
 * One quiet strip of suggestions; never a second primary nav.
 */

import { GROKDESK_REMOTE_UI_ENABLED } from "@grokdesk/shared";

export type CapabilityId =
  | "queue_stack"
  | "schedules"
  | "browser"
  | "connectors"
  | "memory"
  | "recipes"
  | "export_pack"
  | "multi_task"
  | "remote";

export type CapabilityHint = {
  id: CapabilityId;
  /** i18n title key */
  titleKey: string;
  /** i18n body key */
  bodyKey: string;
  /** Where to send the user */
  cta: "home" | "scheduled" | "settings_tools" | "memory" | "tasks" | "none";
  /** Priority 0–100; higher first */
  weight: number;
};

export type UsageSignals = {
  /** User has queued a follow-up at least once. */
  hasUsedQueue: boolean;
  /** Enabled schedule count. */
  scheduleCount: number;
  /** User has opened/used in-app browser. */
  hasUsedBrowser: boolean;
  /** Enabled MCP connector count (non-default). */
  connectorCount: number;
  /** Memory entries count. */
  memoryCount: number;
  /** Saved recipes count. */
  recipeCount: number;
  /** User has exported a chat. */
  hasExported: boolean;
  /** Concurrent working tasks ever seen (>1). */
  hasMultiTasked: boolean;
  /** Remote pairing completed. */
  hasRemote: boolean;
  /** Total finished tasks. */
  doneCount: number;
};

const CATALOG: CapabilityHint[] = [
  {
    id: "queue_stack",
    titleKey: "discovery.queueTitle",
    bodyKey: "discovery.queueBody",
    cta: "tasks",
    weight: 90,
  },
  {
    id: "schedules",
    titleKey: "discovery.scheduleTitle",
    bodyKey: "discovery.scheduleBody",
    cta: "scheduled",
    weight: 80,
  },
  {
    id: "browser",
    titleKey: "discovery.browserTitle",
    bodyKey: "discovery.browserBody",
    cta: "home",
    weight: 75,
  },
  {
    id: "connectors",
    titleKey: "discovery.connectorsTitle",
    bodyKey: "discovery.connectorsBody",
    cta: "settings_tools",
    weight: 70,
  },
  {
    id: "memory",
    titleKey: "discovery.memoryTitle",
    bodyKey: "discovery.memoryBody",
    cta: "memory",
    weight: 65,
  },
  {
    id: "recipes",
    titleKey: "discovery.recipesTitle",
    bodyKey: "discovery.recipesBody",
    cta: "home",
    weight: 60,
  },
  {
    id: "export_pack",
    titleKey: "discovery.exportTitle",
    bodyKey: "discovery.exportBody",
    cta: "tasks",
    weight: 50,
  },
  {
    id: "multi_task",
    titleKey: "discovery.multiTaskTitle",
    bodyKey: "discovery.multiTaskBody",
    cta: "tasks",
    weight: 55,
  },
  {
    id: "remote",
    titleKey: "discovery.remoteTitle",
    bodyKey: "discovery.remoteBody",
    cta: "settings_tools",
    weight: 40,
  },
];

function isDiscovered(id: CapabilityId, s: UsageSignals): boolean {
  switch (id) {
    case "queue_stack":
      return s.hasUsedQueue;
    case "schedules":
      return s.scheduleCount > 0;
    case "browser":
      return s.hasUsedBrowser;
    case "connectors":
      return s.connectorCount > 0;
    case "memory":
      return s.memoryCount > 0;
    case "recipes":
      return s.recipeCount > 0;
    case "export_pack":
      return s.hasExported;
    case "multi_task":
      return s.hasMultiTasked;
    case "remote":
      return s.hasRemote;
    default:
      return true;
  }
}

/**
 * Pick up to `limit` undiscovered capabilities, highest weight first.
 * Only after the user has completed at least one task (avoid first-run noise).
 */
export function pickCapabilityHints(
  signals: UsageSignals,
  limit = 3,
): CapabilityHint[] {
  if (signals.doneCount < 1) return [];
  return CATALOG.filter((c) => {
    if (c.id === "remote" && !GROKDESK_REMOTE_UI_ENABLED) return false;
    return !isDiscovered(c.id, signals);
  })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/** Persist dismissed discovery ids so we don't nag. */
const DISMISS_KEY = "grokdesk.discovery.dismissed.v1";

export function loadDismissedDiscovery(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    if (raw.length > 50_000) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr
        .filter(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && id.length <= 128,
        )
        .slice(0, 200),
    );
  } catch {
    return new Set();
  }
}

export function dismissDiscovery(
  id: CapabilityId,
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): Set<string> {
  const set = loadDismissedDiscovery(storage);
  set.add(id);
  if (storage) {
    try {
      storage.setItem(DISMISS_KEY, JSON.stringify([...set]));
    } catch {
      /* */
    }
  }
  return set;
}

export function filterDismissedHints(
  hints: CapabilityHint[],
  dismissed: Set<string>,
): CapabilityHint[] {
  return hints.filter((h) => !dismissed.has(h.id));
}

export { CATALOG as CAPABILITY_CATALOG, DISMISS_KEY as DISCOVERY_DISMISS_KEY };
