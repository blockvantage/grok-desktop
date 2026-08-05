import { useState } from "react";
import type { CitationItem } from "@/lib/conversation-projector";
import { useT } from "@/i18n";

const MAX_VISIBLE = 4;

export function CitationCards(props: {
  items: CitationItem[];
  onOpenUrl?: (url: string) => void;
}) {
  const { items, onOpenUrl } = props;
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const overflow = items.length - MAX_VISIBLE;
  const visible = expanded || overflow <= 0 ? items : items.slice(0, MAX_VISIBLE);

  return (
    <footer className="mt-3 flex flex-wrap gap-2" aria-label={t("conversation.sources")}>
      {visible.map((item) => {
        const safeUrl = safeCitationUrl(item.url);
        let host = item.url;
        try {
          host = new URL(item.url).hostname.replace(/^www\./, "");
        } catch {
          /* keep raw */
        }
        const content = (
          <>
            <span className="block font-medium text-foreground/90">
              {item.title?.trim() || host}
            </span>
            <span className="block truncate opacity-70">{host}</span>
          </>
        );
        const className = "max-w-[12rem] truncate rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-2xs text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground";
        return safeUrl ? (
          <a
            key={item.url}
            href={safeUrl}
            {...(onOpenUrl
              ? {
                  onClick: (event) => {
                    event.preventDefault();
                    onOpenUrl(safeUrl);
                  },
                }
              : { target: "_blank", rel: "noreferrer noopener" })}
            className={className}
            title={item.title ?? item.url}
          >
            {content}
          </a>
        ) : (
          <span key={item.url} className={className} title={item.title ?? item.url}>
            {content}
          </span>
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

function safeCitationUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
