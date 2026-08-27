import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { WorkEntry } from "@/lib/conversation-projector";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { projectToolKindCard, toolKindDetail } from "@/lib/tool-kind-card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function entriesForWorker(
  entries: WorkEntry[],
  selectedWorkerId: string | null,
): WorkEntry[] {
  if (!selectedWorkerId) return entries;
  return entries.filter((entry) => entry.workerId === selectedWorkerId);
}

type WorkKind =
  | "thought"
  | "tool"
  | "browser"
  | "worker"
  | "artifact"
  | "diagnostic"
  | "work";

export function semanticWorkKind(entry: WorkEntry): WorkKind {
  const tool = String(entry.payload.tool ?? entry.payload.name ?? "");
  if (entry.kind.startsWith("worker_")) return "worker";
  if (entry.kind === "artifact_created") return "artifact";
  if (entry.kind.startsWith("tool_") && tool.startsWith("browser_")) {
    return "browser";
  }
  if (entry.kind.startsWith("tool_")) return "tool";
  if (
    entry.kind === "message" &&
    String(entry.payload.channel ?? "") === "thought"
  ) {
    return "thought";
  }
  if (entry.diagnostic) return "diagnostic";
  return "work";
}

function workKindLabel(kind: WorkKind): string {
  if (kind === "thought") return "conversation.workThought";
  if (kind === "tool") return "conversation.workTool";
  if (kind === "browser") return "conversation.workBrowser";
  if (kind === "worker") return "conversation.workWorker";
  if (kind === "artifact") return "conversation.workArtifact";
  if (kind === "diagnostic") return "conversation.diagnostic";
  return "conversation.workEntry";
}

export function WorkDetails({
  entries,
  selectedWorkerId = null,
  open: controlledOpen,
  onOpenChange,
  onOpenFile,
}: {
  entries: WorkEntry[];
  selectedWorkerId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const visibleEntries = entriesForWorker(entries, selectedWorkerId);

  if (entries.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        if (controlledOpen === undefined) setInternalOpen(next);
        onOpenChange?.(next);
      }}
      data-work-details
    >
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
        {open ? t("conversation.hideWork") : t("conversation.viewWork")}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {visibleEntries.length > 0 ? (
          <ol className="space-y-1 border-l border-border/70 pl-3">
            {visibleEntries.map((entry) => {
              const kind = semanticWorkKind(entry);
              const path =
                typeof entry.payload.path === "string"
                  ? entry.payload.path
                  : null;
              return (
                <li
                  key={entry.id}
                  className="py-1 text-xs"
                  data-work-kind={kind}
                >
                  <div className="flex items-baseline gap-2">
                    {kind === "artifact" && path && onOpenFile ? (
                      <button
                        type="button"
                        className="font-medium text-foreground/85 hover:underline"
                        onClick={() => onOpenFile(path)}
                      >
                        {entry.summary}
                      </button>
                    ) : (
                      <span className="font-medium text-foreground/85">
                        {entry.summary}
                      </span>
                    )}
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {t(workKindLabel(kind))}
                    </span>
                  </div>
                  {(() => {
                    const card =
                      entry.kind === "tool_request" ||
                      entry.kind === "tool_result"
                        ? projectToolKindCard(entry.payload)
                        : null;
                    const friendly = card ? toolKindDetail(card) : null;
                    const body = friendly ?? null;
                    if (!body) return null;
                    return (
                      <details className="mt-1 text-muted-foreground">
                        <summary className="cursor-pointer select-none">
                          {t("conversation.showDetails")}
                        </summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed">
                          {body}
                        </pre>
                      </details>
                    );
                  })()}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="border-l border-border/70 py-1 pl-3 text-xs text-muted-foreground">
            {t("conversation.noWorkerWork")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
