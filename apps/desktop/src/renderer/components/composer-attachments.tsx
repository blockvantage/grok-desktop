import { FileText, ImageIcon, Mic, X } from "lucide-react";
import type { ClientAttachment } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export function ComposerAttachments(props: {
  items: ClientAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  const t = useT();
  if (props.items.length === 0) return null;
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-1.5 px-1 pb-2",
        props.className,
      )}
      aria-label={t("composer.attachmentsAria")}
      data-testid="attachment-chips"
    >
      {props.items.map((a) => (
        <li
          key={a.id}
          className="group flex max-w-[12rem] items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] py-0.5 pl-2 pr-1 text-2xs text-foreground/90"
          data-testid="attachment-chip"
          data-attachment-name={a.name}
        >
          {a.kind === "image" ? (
            <ImageIcon className="h-3 w-3 shrink-0 text-primary" />
          ) : a.kind === "audio" ? (
            <Mic className="h-3 w-3 shrink-0 text-primary/90" />
          ) : (
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate" title={a.sourcePath}>
            {a.name}
          </span>
          <button
            type="button"
            className="rounded-full p-0.5 text-muted-foreground opacity-70 hover:bg-white/10 hover:opacity-100"
            aria-label={t("composer.removeAttachment", { name: a.name })}
            onClick={() => props.onRemove(a.id)}
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
