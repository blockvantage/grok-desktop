/**
 * Task 16: adjacent composer delivery feedback (offline + enqueue error).
 * Single source for status copy near the follow-up form.
 */
import {
  planComposerOfflineAction,
} from "@/lib/queue-row-presentation";
import { useT } from "@/i18n";

export function ConversationStatus(props: {
  engineReady: boolean;
  hasDraft: boolean;
  hasSavedLocalQueue: boolean;
  enqueueError: string | null;
}) {
  const t = useT();
  const offline = planComposerOfflineAction({
    engineReady: props.engineReady,
    hasDraft: props.hasDraft,
    hasSavedLocalQueue: props.hasSavedLocalQueue,
  });
  if (!offline && !props.enqueueError) return null;
  return (
    <div
      className="mx-auto mb-1.5 max-w-[46rem] space-y-1 px-1"
      data-testid="composer-delivery-feedback"
      data-conversation-status
    >
      {offline ? (
        <p
          className="text-2xs text-muted-foreground"
          role="status"
          aria-live="polite"
          data-composer-offline-action={offline.key}
        >
          {t(offline.key)}
        </p>
      ) : null}
      {props.enqueueError ? (
        <p
          className="text-2xs text-destructive-text"
          role="status"
          aria-live="polite"
          data-composer-enqueue-error
        >
          {props.enqueueError}
        </p>
      ) : null}
    </div>
  );
}
