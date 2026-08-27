/**
 * Task 16: conversation outbox list shell (queued message rows).
 * Owns presentation only — queue mutations stay with the controller.
 */
import { QueuedMessageRow } from "@/components/conversation/queued-message-row";
import type { DurableQueuedMessage } from "@/lib/message-queue-store";
import { useT } from "@/i18n";

export function ConversationOutbox(props: {
  items: DurableQueuedMessage[];
  busy: boolean;
  interjectingIds: ReadonlySet<string>;
  /** False when the engine cannot interject (headless). */
  sendNowSupported?: boolean;
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
  className?: string;
}) {
  const t = useT();
  if (props.items.length === 0) return null;
  return (
    <div
      className={props.className ?? "mx-auto mb-2 max-w-[46rem] space-y-1.5"}
      data-testid="conversation-outbox"
    >
      <div className="flex items-center justify-between px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>
          {t("workspace.queueTitle")} · {props.items.length}
        </span>
      </div>
      <ul className="space-y-1">
        {props.items.map((m, idx) => (
          <QueuedMessageRow
            key={m.id}
            item={m}
            index={idx}
            busy={props.busy}
            interjecting={props.interjectingIds.has(m.id)}
            sendNowSupported={props.sendNowSupported}
            onEdit={props.onEdit}
            onEditAndSendNow={props.onEditAndSendNow}
            onRetry={props.onRetry}
            onSendNow={props.onSendNow}
            onRemove={props.onRemove}
            onPickFiles={props.onPickFiles}
          />
        ))}
      </ul>
    </div>
  );
}
