import { useEffect, useId, useState } from "react";
import DOMPurify from "dompurify";
import { useT } from "@/i18n";
import { useAppearance } from "@/components/appearance-provider";

/**
 * Restrict mermaid output to presentational SVG. The SVG profile already
 * drops foreignObject today; forbidding it explicitly keeps HTML injection
 * impossible even if a future DOMPurify profile relaxes.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject"],
  });
}

/**
 * Render a mermaid fence as sanitized inline SVG with a view-source toggle.
 * Mermaid is loaded dynamically so non-diagram chats stay light.
 */
export function MermaidBlock(props: { code: string }) {
  const t = useT();
  const { resolved } = useAppearance();
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolved === "light" ? "neutral" : "dark",
        });
        const id = `mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, props.code);
        if (!cancelled) {
          setSvg(sanitizeMermaidSvg(rendered));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSvg(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.code, reactId, resolved]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-hairline bg-muted/40">
      <div className="flex items-center justify-between border-b border-hairline-quiet px-2 py-1">
        <span className="text-2xs uppercase tracking-wide text-muted-foreground">
          {t("mermaid.title")}
        </span>
        <button
          type="button"
          className="text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowSource((v) => !v)}
        >
          {showSource ? t("mermaid.viewDiagram") : t("mermaid.viewSource")}
        </button>
      </div>
      {showSource || error ? (
        <pre className="overflow-x-auto p-3 text-xs text-muted-foreground">
          {props.code}
          {error ? `\n\n// render error: ${error}` : ""}
        </pre>
      ) : svg ? (
        <div
          className="overflow-x-auto p-3 [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="p-3 text-2xs text-muted-foreground">
          {t("mermaid.rendering")}
        </div>
      )}
    </div>
  );
}
