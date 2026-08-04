import { Button } from "@/components/ui/button";
import type { RecoveryViewModel, RecoveryAction } from "@/lib/error-recovery";

export function RecoveryBanner(props: {
  model: RecoveryViewModel;
  onAction: (action: RecoveryAction) => void;
}) {
  const { model } = props;
  return (
    <div
      className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="text-sm font-semibold text-warning">{model.title}</div>
      <p className="mt-1 text-xs leading-relaxed text-warning">
        {model.body}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {model.primary && (
          <Button
            size="sm"
            className="h-8"
            onClick={() => props.onAction(model.primary!.action)}
          >
            {model.primary.label}
          </Button>
        )}
        {model.secondary && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-warning/30 bg-transparent"
            onClick={() => props.onAction(model.secondary!.action)}
          >
            {model.secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}
