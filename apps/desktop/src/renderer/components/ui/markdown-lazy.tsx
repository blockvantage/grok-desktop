import { lazy, Suspense, type ComponentProps } from "react";

const MarkdownEager = lazy(() =>
  // Use the memoized default export (memo(Markdown)) — the named export is the
  // raw, unmemoized function. Going through the memo lets finished turns skip
  // re-parsing (react-markdown + rehype-highlight) on every stream tick when
  // their text prop is unchanged.
  import("./markdown").then((m) => ({ default: m.default })),
);

/** Code-split markdown + highlight.js out of the main renderer chunk. */
export function Markdown(props: ComponentProps<typeof MarkdownEager>) {
  // Keep fallback dimensionally quiet: no pulse/ellipsis that flashes as "…" then content.
  return (
    <Suspense
      fallback={
        <div
          className={props.className}
          aria-hidden
          style={{ minHeight: "1.25em", opacity: 0.55 }}
        >
          {/* Preserve plain text until the markdown chunk loads */}
          <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/85">
            {typeof props.children === "string"
              ? props.children.slice(0, 800)
              : null}
          </div>
        </div>
      }
    >
      <MarkdownEager {...props} />
    </Suspense>
  );
}
