import type { ReactNode } from "react";
import { selectNotices, type NoticeItem } from "@/lib/notice-priority";
import { useT } from "@/i18n";

/**
 * Renders at most maxVisible prioritized notices. Callers pass a full list;
 * lower-priority items are dropped (surface them via Inbox instead).
 */
export function NoticeSlot(props: {
  notices: NoticeItem[];
  maxVisible?: number;
  render: (notice: NoticeItem) => ReactNode;
  className?: string;
}) {
  const t = useT();
  const visible = selectNotices(props.notices, props.maxVisible ?? 2);
  if (visible.length === 0) return null;
  // Assertive for top-priority lifecycle failures (gateway dead / entitlement);
  // polite for lower-priority surface notices so we don't interrupt mid-compose.
  const assertive = visible.some(
    (n) =>
      n.kind === "gateway_dead" ||
      n.kind === "entitlement" ||
      n.kind === "readiness",
  );
  return (
    <div
      className={props.className ?? "space-y-2"}
      role="region"
      aria-label={t("shell.noticesAria")}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="false"
    >
      {visible.map((n) => (
        <div key={n.id}>{props.render(n)}</div>
      ))}
    </div>
  );
}
