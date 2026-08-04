/**
 * Home/shell notice priority (I2): at most maxVisible banners.
 * One status owner: severity-ranked stack owns all blocking reasons;
 * suppress lower-priority chrome while a higher one is active.
 *
 * Order (lower number = higher priority):
 * gateway dead > entitlement/runtime > reauth > update/security >
 * approval/needs-you > running > usage
 */

export type NoticeKind =
  | "gateway_dead"
  | "gateway_reconnecting"
  | "entitlement"
  | "runtime"
  | "signing_in"
  | "reauth"
  | "security_update"
  | "update"
  | "needs_you"
  | "running"
  | "usage"
  | "readiness";

export type NoticeItem = {
  id: string;
  kind: NoticeKind;
  /** Lower number = higher priority */
  priority: number;
};

const PRIORITY: Record<NoticeKind, number> = {
  gateway_dead: 0,
  gateway_reconnecting: 1,
  entitlement: 2,
  runtime: 3,
  readiness: 4,
  signing_in: 5,
  reauth: 6,
  security_update: 7,
  update: 8,
  needs_you: 9,
  running: 10,
  usage: 11,
};

export function noticePriority(kind: NoticeKind): number {
  return PRIORITY[kind];
}

/**
 * Sort by priority ascending and keep the top `max` items.
 * When a hard blocker (priority ≤ readiness) is present, drop soft notices
 * (running/usage) so default users are not shouted at by competing chrome.
 */
export function selectNotices(
  items: NoticeItem[],
  max = 2,
): NoticeItem[] {
  const sorted = [...items].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  const hard = sorted.find((n) => n.priority <= PRIORITY.readiness);
  const filtered = hard
    ? sorted.filter(
        (n) =>
          n.priority <= PRIORITY.readiness ||
          n.kind === "needs_you" ||
          n.kind === "signing_in" ||
          n.kind === "reauth",
      )
    : sorted;
  return filtered.slice(0, max);
}

/** True when kind is a create/run hard blocker family. */
export function isBlockingNoticeKind(kind: NoticeKind): boolean {
  return (
    kind === "gateway_dead" ||
    kind === "entitlement" ||
    kind === "runtime" ||
    kind === "readiness" ||
    kind === "reauth"
  );
}
