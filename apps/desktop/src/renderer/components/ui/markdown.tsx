import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { readAsset, assetDisplaySrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { t } from "@/i18n/active";
import { MermaidBlock } from "./mermaid-block";

/** Only http(s) and in-page anchors — blocks javascript:/data:/file:/custom schemes. */
function sanitizeMarkdownHref(href: string | undefined): string | null {
  if (!href) return null;
  const t = href.trim();
  if (!t) return null;
  if (t.startsWith("#")) return t;
  try {
    const u = new URL(t);
    const p = u.protocol.toLowerCase();
    if (p !== "http:" && p !== "https:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Base directory used to resolve relative image paths inside rendered markdown
 * (e.g. an agent that writes `![chart](out/chart.png)` in a note). Absolute and
 * remote sources ignore it.
 */
const BaseDirContext = createContext<string | null>(null);

export function Markdown({
  children,
  className,
  baseDir = null,
  onOpenUrl,
}: {
  children: string;
  className?: string;
  baseDir?: string | null;
  onOpenUrl?: (url: string) => void;
}) {
  return (
    <BaseDirContext.Provider value={baseDir}>
      <div className={cn("typeset", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={{
            pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
            code: ({ className, children }) => {
              if (isBlockCode(className, children)) {
                return <code className={className}>{children}</code>;
              }
              return <code>{children}</code>;
            },
            a: ({ href, children }) => {
              const safe = sanitizeMarkdownHref(
                typeof href === "string" ? href : undefined,
              );
              if (!safe) {
                return <span>{children}</span>;
              }
              if (safe.startsWith("#")) {
                return <a href={safe}>{children}</a>;
              }
              return (
                <a
                  href={safe}
                  {...(onOpenUrl
                    ? {
                        onClick: (event) => {
                          event.preventDefault();
                          onOpenUrl(safe);
                        },
                      }
                    : { target: "_blank", rel: "noreferrer noopener" })}
                >
                  {children}
                </a>
              );
            },
            img: ({ src, alt }) => {
              // Block remote https images by default (tracking / IP leak).
              // Allow self/data/blob/grokdesk-asset and relative paths only.
              const s = typeof src === "string" ? src : "";
              if (/^https?:\/\//i.test(s)) {
                return (
                  <span className="md-remote-img-blocked" title={t("markdown.remoteImagesBlocked")}>
                    [{alt || "image"}]
                  </span>
                );
              }
              return <AssetImage src={s} alt={alt} />;
            },
            // GFM task lists only — never render free-form inputs from agent markdown.
            input: ({ node, ...props }) =>
              props.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={Boolean(props.checked)}
                  disabled
                  readOnly
                  className="md-task-check"
                />
              ) : null,
            li: ({ node, className, children, ...rest }) => (
              <li
                className={cn(className, className?.includes("task") && "md-task")}
                {...rest}
              >
                {children}
              </li>
            ),
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    </BaseDirContext.Provider>
  );
}

const LANG_CLASS = /language-(\w+)/;

/** Block code = a fenced/indented block; inline code = a short span. */
function isBlockCode(className?: string, children?: ReactNode): boolean {
  if (className && LANG_CLASS.test(className)) return true;
  if (typeof children === "string") return children.includes("\n");
  if (Array.isArray(children)) {
    return children.some((c) => typeof c === "string" && c.includes("\n"));
  }
  return false;
}

/** CHAT-7: true when clamped content exceeds the visible max-height. */
export function codeBlockOverflows(
  scrollHeight: number,
  clientHeight: number,
  tolerancePx = 1,
): boolean {
  return scrollHeight > clientHeight + tolerancePx;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const codeChild = Children.toArray(children).find(isValidElement) as
    | { props?: { className?: string; children?: ReactNode } }
    | undefined;
  const lang = codeChild?.props?.className?.match(LANG_CLASS)?.[1] ?? "";

  useEffect(() => {
    if (lang.toLowerCase() === "mermaid") return;
    const el = preRef.current;
    if (!el) return;

    const measure = () => {
      // When expanded, max-height is lifted — re-measure against the collapsed
      // clamp by temporarily clearing the expanded class is not free; instead
      // keep the last known overflow once true (content rarely shrinks).
      if (expanded) return;
      setOverflows(codeBlockOverflows(el.scrollHeight, el.clientHeight));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, expanded, lang]);

  if (lang.toLowerCase() === "mermaid") {
    const raw = codeChild?.props?.children;
    const code =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.map(String).join("")
          : String(raw ?? "");
    return <MermaidBlock code={code.replace(/\n$/, "")} />;
  }

  const copy = async () => {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard blocked; no-op
    }
  };

  const showToggle = overflows || expanded;

  return (
    <div className={cn("code-block", expanded && "code-block-expanded")}>
      <div className="code-block-head">
        <span className="code-block-lang">{lang || "code"}</span>
        <div className="flex items-center gap-1">
          {showToggle ? (
            <button
              type="button"
              className="code-block-copy"
              data-code-expand
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t("markdown.collapse") : t("markdown.expand")}
            </button>
          ) : null}
          <button type="button" className="code-block-copy" onClick={copy}>
            {copied ? (
              <>
                <Check className="h-3 w-3" strokeWidth={2} />
                {t("stream.copied")}
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" strokeWidth={1.75} />
                {t("stream.copy")}
              </>
            )}
          </button>
        </div>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const REMOTE = /^(https?:|data:|blob:)/i;

/**
 * Renders a markdown image. Remote/data URLs render directly; local file paths
 * are pulled through the workspace asset bridge and shown as a data URL, so an
 * agent's on-disk screenshots and charts appear inline.
 */
function AssetImage({ src, alt }: { src: string; alt?: string }) {
  const baseDir = useContext(BaseDirContext);
  const [resolved, setResolved] = useState<string | null>(() =>
    REMOTE.test(src) ? src : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src || REMOTE.test(src)) {
      setResolved(REMOTE.test(src) ? src : null);
      return;
    }
    let cancelled = false;
    const abs = resolveLocal(src, baseDir);
    void readAsset(abs, { root: baseDir })
      .then((a) => {
        if (!cancelled) setResolved(assetDisplaySrc(a));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, baseDir]);

  if (failed || (!resolved && !src)) {
    return <span className="md-img-loading">{alt || "image"}</span>;
  }
  if (!resolved) {
    return <span className="md-img-loading">Loading {alt || "image"}…</span>;
  }
  return (
    <img
      className="md-img"
      src={resolved}
      alt={alt || ""}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function resolveLocal(src: string, baseDir: string | null): string {
  const clean = src.replace(/^file:\/\//, "");
  if (clean.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(clean)) return clean;
  if (!baseDir) return clean;
  return `${baseDir.replace(/[\\/]+$/, "")}/${clean.replace(/^\.\//, "")}`;
}

export default memo(Markdown);
