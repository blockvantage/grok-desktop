import { useState } from "react";
import type { CitationItem } from "@/lib/conversation-projector";
import { useT } from "@/i18n";

const MAX_VISIBLE = 4;

export function CitationCards(props: { items: CitationItem[] }) {
  const { items } = props;
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const overflow = items.length - MAX_VISIBLE;
  const visible = expanded || overflow <= 0 ? items : items.slice(0, MAX_VISIBLE);

  return (
    <footer className="mt-3 flex flex-wrap gap-2" aria-label={t("conversation.sources")}>
      {visible.map((item) => {
        let host = item.url;
        try {
          host = new URL(item.url).hostname.replace(/^www\./, "");
        } catch {
          /* keep raw */
        }
        return (
          <a
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="max-w-[12rem] truncate rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-2xs text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
            title={item.title ?? item.url}
          >
            <span className="block font-medium text-foreground/90">
              {item.title?.trim() || host}
            </span>
            <span className="block truncate opacity-70">{host}</span>
          </a>
        );
      })}
      {overflow > 0 && (
        <button
          type="button"
          data-citations-toggle
          className="self-center rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t("citations.showLess")
            : t("citations.showAll", { n: items.length })}
        </button>
      )}
    </footer>
  );
}
