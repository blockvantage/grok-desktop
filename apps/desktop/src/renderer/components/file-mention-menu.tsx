import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import {
  mentionSecondaryLabel,
  type MentionCandidate,
} from "@/lib/mention-files";
import {
  getInputCaretClientRect,
  getTextareaCaretClientRect,
  placeMentionMenu,
} from "@/lib/textarea-caret";

export function FileMentionMenu(props: {
  items: MentionCandidate[];
  activeIndex: number;
  onSelect: (item: MentionCandidate) => void;
  onHover: (index: number) => void;
  /** Textarea (or input) that owns the caret — used for positioning. */
  anchorRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** Character index in the field value for the caret / @ query end. */
  caretIndex?: number;
  /** Workspace roots used to shorten path subtitles. */
  roots?: string[];
  className?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [props.activeIndex]);

  useLayoutEffect(() => {
    if (props.items.length === 0) return;

    const update = () => {
      const anchor = props.anchorRef?.current;
      const menuEl = listRef.current;
      if (!anchor || props.caretIndex == null) {
        // Fallback: parent-relative above the composer (legacy layout).
        setPos(null);
        return;
      }

      const caret =
        anchor instanceof HTMLTextAreaElement
          ? getTextareaCaretClientRect(anchor, props.caretIndex)
          : getInputCaretClientRect(anchor, props.caretIndex);

      const measuredH = menuEl?.offsetHeight || 192;
      const measuredW = menuEl?.offsetWidth || 320;
      const place = placeMentionMenu({
        caret,
        menuWidth: Math.min(360, measuredW || 320),
        menuHeight: measuredH,
      });

      setPos({
        position: "fixed",
        top: place.top,
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
        zIndex: 50,
      });
    };

    update();
    // Second pass after paint so maxHeight/width measurements settle.
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    // Capture scroll on any ancestor so the menu tracks the caret.
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [props.items, props.caretIndex, props.anchorRef, props.activeIndex]);

  if (props.items.length === 0) return null;

  const roots = props.roots ?? [];
  const wantsAnchor = Boolean(props.anchorRef);
  const positioned = pos != null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      style={
        pos ??
        (wantsAnchor
          ? { position: "fixed", visibility: "hidden", top: 0, left: 0 }
          : undefined)
      }
      className={cn(
        "z-30 max-h-48 overflow-auto rounded-xl border border-white/10 bg-[hsl(var(--surface-3))] p-1 shadow-xl",
        positioned || wantsAnchor
          ? "fixed"
          : "absolute bottom-full left-0 mb-1 w-full max-w-md",
        props.className,
      )}
    >
      {props.items.map((item, i) => {
        const secondary = mentionSecondaryLabel(item.path, roots);
        return (
          <li
            key={`${item.group}:${item.path}`}
            ref={i === props.activeIndex ? activeRef : null}
          >
            <button
              type="button"
              role="option"
              aria-selected={i === props.activeIndex}
              className={cn(
                "flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left text-xs",
                i === props.activeIndex
                  ? "bg-primary/20 text-foreground"
                  : "text-foreground/90 hover:bg-white/[0.06]",
              )}
              onMouseEnter={() => props.onHover(i)}
              onClick={() => props.onSelect(item)}
            >
              <span className="font-medium">{item.name}</span>
              <span className="max-w-full truncate text-2xs text-muted-foreground">
                {item.group} · {secondary}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
