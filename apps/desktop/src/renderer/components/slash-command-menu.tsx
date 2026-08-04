import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SlashCommand } from "@/lib/composer-input";
import { useT } from "@/i18n";

// The menu grows upward from bottom-full, so its height must be capped to the
// space between the anchor and the titlebar or the top rows leave the window.
const TOP_CLEARANCE = 60; // 52px titlebar + breathing room
const ANCHOR_GAP = 8; // matches mb-2
const MAX_HEIGHT = 224; // matches max-h-56
const MIN_HEIGHT = 128;

export function SlashCommandMenu(props: {
  items: SlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SlashCommand) => void;
  /** Echoed user args after an exact command token (SC-5). */
  args?: string;
  /**
   * When the query is active but nothing matches, show a muted non-interactive
   * hint row instead of unmounting (SC-4).
   */
  emptyHint?: string;
  className?: string;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const argsEcho = props.args?.trim() ?? "";
  const showEmpty = props.items.length === 0 && Boolean(props.emptyHint);

  useLayoutEffect(() => {
    const list = listRef.current;
    const wrap = wrapRef.current;
    if (!list || !wrap) return;

    const sync = () => {
      const anchor = wrap.offsetParent as HTMLElement | null;
      if (anchor) {
        const room =
          anchor.getBoundingClientRect().top - ANCHOR_GAP - TOP_CLEARANCE;
        list.style.maxHeight = `${Math.round(
          Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, room)),
        )}px`;
      }
      setFade({
        top: list.scrollTop > 2,
        bottom: list.scrollTop + list.clientHeight < list.scrollHeight - 2,
      });
    };

    sync();
    list.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      list.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [props.items.length, showEmpty]);

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [props.activeIndex, props.items]);

  if (props.items.length === 0 && !showEmpty) return null;
  return (
    <div
      ref={wrapRef}
      className={cn(
        // Opaque, no backdrop-filter: on the vibrancy (transparent) window
        // backdrop-blur breaks compositing and the background never paints.
        "absolute bottom-full left-0 z-40 mb-2 w-full max-w-sm overflow-hidden rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-3))] shadow-[0_16px_48px_-16px_rgba(0,0,0,0.8)]",
        props.className,
      )}
    >
      <ul
        ref={listRef}
        role="listbox"
        className="max-h-56 overflow-y-auto overscroll-contain p-1"
      >
        {showEmpty ? (
          <li role="presentation" className="px-2.5 py-2">
            <span className="block text-xs leading-snug text-muted-foreground">
              {props.emptyHint}
            </span>
          </li>
        ) : (
          props.items.map((item, i) => {
            const active = i === props.activeIndex;
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={active}
                ref={active ? activeRef : null}
                className="scroll-my-6"
              >
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-primary/15 text-foreground"
                      : "text-foreground/90 hover:bg-white/[0.05]",
                  )}
                  onMouseEnter={() => props.onHover(i)}
                  onClick={() => props.onSelect(item)}
                >
                  <span className="mt-0.5 shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                    /{item.token}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-tight">
                      {t(item.labelKey)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {t(item.descKey)}
                    </span>
                    {argsEcho ? (
                      <span className="mt-0.5 block truncate font-mono text-xs leading-snug text-muted-foreground">
                        {argsEcho}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-[hsl(var(--surface-3))] to-transparent transition-opacity duration-150",
          fade.top ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-[hsl(var(--surface-3))] to-transparent transition-opacity duration-150",
          fade.bottom ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
