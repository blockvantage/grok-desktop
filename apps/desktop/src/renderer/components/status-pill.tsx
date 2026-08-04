import { Badge } from "@/components/ui/badge";
import {
  deriveDeliveryPhase,
  deliveryPhaseLabel,
  type DeliveryInput,
  type DeliveryPhase,
} from "@/lib/delivery-state";
import { taskStatusLabel } from "@/lib/labels";
import {
  taskStatusEmphasisPillClass,
  taskStatusPillClass,
} from "@/lib/status-styles";
import { cn } from "@/lib/utils";

/** Map delivery phase to pill color token (task status string). */
function phaseToStatusToken(phase: DeliveryPhase): string {
  switch (phase) {
    case "running":
      return "running";
    case "queued":
    case "accepted":
    case "saving":
    case "saved_local":
    case "connecting":
    case "delivery_unknown":
      return "queued";
    case "needs_attention":
      return "waiting_user";
    case "terminal":
      return "done";
    case "draft":
    default:
      return "queued";
  }
}

export function StatusPill({
  status,
  emphasis = false,
  className,
  delivery,
}: {
  status: string;
  /**
   * When set, "needs-you" / "blocked" states render loud (ring + solid tint)
   * so the single header signal is unmistakable. Lists leave this off.
   */
  emphasis?: boolean;
  className?: string;
  /**
   * When provided, label and tone come from the delivery-phase model so
   * optimistic / unaccepted work never claims Working (Task 10).
   */
  delivery?: DeliveryInput;
}) {
  const phase = delivery
    ? deriveDeliveryPhase({ ...delivery, taskStatus: delivery.taskStatus ?? status })
    : null;
  const displayStatus = phase ? phaseToStatusToken(phase) : status;
  const label = phase ? deliveryPhaseLabel(phase) : taskStatusLabel(status);
  const emphasized = emphasis ? taskStatusEmphasisPillClass(displayStatus) : null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded-full border-0 px-2 text-2xs font-medium tracking-tight",
        emphasized ?? taskStatusPillClass(displayStatus),
        emphasized && "px-2.5",
        className,
      )}
      data-delivery-phase={phase ?? undefined}
    >
      {label}
    </Badge>
  );
}
