/**
 * In-app What's new (Phase 3.6).
 * Desk notes are bundled; runtime notes are optional and version-gated.
 */

import { GROKDESK_VERSION } from "@grokdesk/shared";

export type WhatsNewItem = {
  version: string;
  source: "desk" | "runtime";
  titleKey: string;
  itemKeys: string[];
};

export const WHATS_NEW_STORAGE_KEY = "grokdesk.whatsNew.seen.v1";

/** Desk notes for the current program. Newest first. */
export const DESK_WHATS_NEW: WhatsNewItem[] = [
  {
    version: GROKDESK_VERSION,
    source: "desk",
    titleKey: "whatsNew.desk.v1.title",
    itemKeys: [
      "whatsNew.desk.v1.a",
      "whatsNew.desk.v1.b",
      "whatsNew.desk.v1.c",
    ],
  },
];

/** Runtime notes that match a known CLI line (optional). */
export const RUNTIME_WHATS_NEW: WhatsNewItem[] = [
  {
    version: "1.0.10",
    source: "runtime",
    titleKey: "whatsNew.runtime.v1010.title",
    itemKeys: [
      "whatsNew.runtime.v1010.a",
      "whatsNew.runtime.v1010.b",
    ],
  },
];

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function unseenWhatsNew(input: {
  lastSeenVersion: string | null;
  deskVersion?: string;
  runtimeVersion?: string | null;
}): WhatsNewItem[] {
  const last = input.lastSeenVersion;
  const desk = DESK_WHATS_NEW.filter(
    (e) => !last || compareVersions(e.version, last) > 0,
  );
  const runtimeVer = input.runtimeVersion?.trim() || null;
  const runtime = runtimeVer
    ? RUNTIME_WHATS_NEW.filter(
        (e) =>
          compareVersions(runtimeVer, e.version) >= 0 &&
          (!last || compareVersions(e.version, last) > 0),
      )
    : [];
  return [...desk, ...runtime];
}

export function shouldShowWhatsNew(entries: WhatsNewItem[]): boolean {
  return entries.length > 0;
}

/** All notes for Settings → What's new (not just unseen). */
export function allWhatsNew(runtimeVersion?: string | null): WhatsNewItem[] {
  const runtimeVer = runtimeVersion?.trim() || null;
  const runtime = runtimeVer
    ? RUNTIME_WHATS_NEW.filter(
        (e) => compareVersions(runtimeVer, e.version) >= 0,
      )
    : [];
  return [...DESK_WHATS_NEW, ...runtime];
}

export function highestWhatsNewVersion(
  entries: WhatsNewItem[],
  deskVersion: string = GROKDESK_VERSION,
): string {
  let max = deskVersion;
  for (const e of entries) {
    if (compareVersions(e.version, max) > 0) max = e.version;
  }
  return max;
}

export function loadWhatsNewSeen(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): string | null {
  try {
    const v = storage?.getItem(WHATS_NEW_STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function saveWhatsNewSeen(
  version: string,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  try {
    storage?.setItem(WHATS_NEW_STORAGE_KEY, version);
  } catch {
    /* ignore */
  }
}
