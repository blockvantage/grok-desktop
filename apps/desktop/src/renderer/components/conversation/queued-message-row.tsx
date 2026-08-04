import { useState } from "react";
import { Paperclip, Trash2, X as XIcon, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  isDurableQueueItemLocked,
  type DurableQueuedMessage,
} from "@/lib/message-queue-store";
import { planQueueLifecycleStatus } from "@/lib/queue-row-presentation";
import { cn } from "@/lib/utils";

export function QueuedMessageRow(props: {
  item: DurableQueuedMessage;
  index: number;
  /** A different follow-up is being accepted. */
  busy: boolean;
  /** This item's mid-run interjection RPC is in flight (disables Send-now). */
  interjecting?: boolean;
  onEdit: (
    id: string,
    patch: { text?: string; attachmentPaths?: string[] | undefined },
  ) => void;
  onEditAndSendNow: (
    item: DurableQueuedMessage,
    patch: { text?: string; attachmentPaths?: string[] | undefined },
  ) => void;
  onRetry: (item: DurableQueuedMessage) => void;
  onSendNow: (item: DurableQueuedMessage) => void;
  onRemove: (id: string) => void;
  onPickFiles: () => Promise<string[]>;
}) {
  const t = useT();
  const { item } = props;
  const [editing, setEditing] = useState(false);
  const [editingText, setEditingText] = useState(item.text);
  const failed = item.status === "failed";
  const locked = isDurableQueueItemLocked(item);
  const sendDisabled = props.busy || locked || Boolean(props.interjecting);
  const missingAttachment = failed && item.failReason === "missing_attachment";
  const lifecycle = planQueueLifecycleStatus({
    status: item.status,
    index: props.index,
    interjecting: props.interjecting,
    failReason: item.failReason ?? null,
  });
  const lifecycleCopy = lifecycle.params
    ? t(lifecycle.key, lifecycle.params)
    : t(lifecycle.key);

  const finishEdit = () => {
    props.onEdit(item.id, { text: editingText });
    setEditing(false);
  };

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-xl border px-2.5 py-1.5",
        failed
          ? "border-destructive/30 bg-destructive/5"
          : "border-white/[0.07] bg-white/[0.03]",
        locked && "opacity-70",
      )}
      data-queue-status={item.status}
    >
      <span className="w-5 shrink-0 text-center font-mono text-2xs text-muted-foreground">
        {props.index + 1}
      </span>

      <div className="min-w-0 flex-1">
        {editing && !locked ? (
          <input
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1 text-sm"
            value={editingText}
            autoFocus
            onChange={(event) => setEditingText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                finishEdit();
              } else if (event.key === "Escape") {
                setEditing(false);
                setEditingText(item.text);
              } else if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter"
              ) {
                event.preventDefault();
                setEditing(false);
                props.onEditAndSendNow(item, { text: editingText });
              }
            }}
            onBlur={finishEdit}
            aria-label={t("workspace.queueEdit")}
          />
        ) : (
          <button
            type="button"
            className="block w-full truncate text-left text-sm text-foreground/90 hover:underline disabled:no-underline"
            data-queue-edit={item.id}
            aria-label={t("workspace.queueEdit")}
            title={t("workspace.queueEdit")}
            disabled={locked}
            onClick={() => {
              setEditingText(item.text);
              setEditing(true);
            }}
          >
            {item.text}
          </button>
        )}
        {lifecycleCopy ? (
          <div
            className={cn(
              "mt-0.5 text-2xs",
              failed ? "text-destructive-text" : "text-muted-foreground",
            )}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-queue-lifecycle-status={item.status}
            data-queue-fail-reason={item.failReason ?? undefined}
          >
            {lifecycleCopy}
          </div>
        ) : null}
      </div>

      <div className="flex max-w-[10rem] flex-wrap items-center gap-0.5">
        {(item.attachmentPaths ?? []).map((path) => {
          const name = path.split(/[/\\]/).pop() || path;
          return (
            <span
              key={path}
              className={cn(
                "inline-flex max-w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-2xs",
                missingAttachment
                  ? "bg-destructive/10 text-destructive-text"
                  : "bg-white/[0.06] text-muted-foreground",
              )}
              title={path}
              data-queue-attachment={path}
              data-queue-attachment-missing={
                missingAttachment ? "true" : undefined
              }
            >
              <Paperclip className="h-2.5 w-2.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{name}</span>
              {!locked ? (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive-text"
                  aria-label={t("workspace.queueRemoveAttachment")}
                  title={t("workspace.queueRemoveAttachment")}
                  onClick={() => {
                    props.onEdit(item.id, {
                      attachmentPaths: (item.attachmentPaths ?? []).filter(
                        (candidate) => candidate !== path,
                      ),
                    });
                  }}
                >
                  <XIcon className="h-2.5 w-2.5" strokeWidth={2} />
                </button>
              ) : null}
            </span>
          );
        })}
        {!locked ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              "h-7 w-7 shrink-0",
              missingAttachment
                ? "text-primary"
                : "text-muted-foreground",
            )}
            title={
              missingAttachment
                ? t("workspace.queueRepickAttachment")
                : t("workspace.queueAddAttachment")
            }
            aria-label={
              missingAttachment
                ? t("workspace.queueRepickAttachment")
                : t("workspace.queueAddAttachment")
            }
            data-queue-add-attachment={item.id}
            data-queue-repick-attachment={
              missingAttachment ? item.id : undefined
            }
            onClick={() => {
              void props.onPickFiles().then((paths) => {
                if (!paths.length) return;
                // Missing-file recovery: replace paths rather than only appending
                // so the vanished file is not still claimed on the next drain.
                props.onEdit(item.id, {
                  attachmentPaths: missingAttachment
                    ? [...new Set(paths)]
                    : [
                        ...new Set([
                          ...(item.attachmentPaths ?? []),
                          ...paths,
                        ]),
                      ],
                });
              });
            }}
          >
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>

      {failed ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-2xs text-primary"
          data-queue-retry={item.id}
          aria-label={t("workspace.queueRetry")}
          title={t("workspace.queueRetry")}
          disabled={sendDisabled}
          onClick={() => props.onRetry(item)}
        >
          {t("workspace.queueRetry")}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 px-2 text-2xs text-muted-foreground hover:text-primary"
          data-queue-send-now={item.id}
          aria-label={t("workspace.queueSendNow")}
          title={
            sendDisabled
              ? t("workspace.queueSendNowUnavailable")
              : t("workspace.queueSendNow")
          }
          disabled={sendDisabled}
          onClick={() => props.onSendNow(item)}
        >
          <Zap className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t("workspace.queueSendNow")}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-2 text-2xs text-muted-foreground hover:text-destructive-text"
        data-queue-remove={item.id}
        aria-label={t("workspace.queueRemove")}
        title={t("workspace.queueRemove")}
        disabled={locked}
        onClick={() => props.onRemove(item.id)}
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        <span>{t("workspace.queueRemoveShort")}</span>
      </Button>
    </li>
  );
}
