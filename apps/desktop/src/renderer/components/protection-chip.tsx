/**
 * I3 / T3: effective protection chip — never claims Safe workspace without sandbox.
 */
import { useState } from "react";
import { Shield, ChevronDown, ChevronUp } from "lucide-react";
import { useT } from "@/i18n";
import type { ProtectionChipView } from "@/lib/protection-chip";
import { cn } from "@/lib/utils";

const SEGMENT_KEYS: Record<string, string> = {
  sandbox: "protection.sandbox",
  sandbox_unavailable: "protection.sandboxUnavailable",
  approvals: "protection.approvals",
  network_tools: "protection.networkTools",
  shell: "protection.shell",
  isolated_profile: "protection.isolatedProfile",
  inherited_profile: "protection.inheritedProfile",
  partial_mediation: "protection.partialMediation",
};

export function ProtectionChip(props: {
  view: ProtectionChipView;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { view } = props;

  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-col gap-1 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-xs",
        props.className,
      )}
      data-testid="protection-chip"
      data-claims-safe={view.claimsSafe ? "true" : "false"}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("protection.chip")}
      >
        <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate font-medium text-foreground">
          {t(view.summaryKey)}
        </span>
        {open ? (
          <ChevronUp className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        )}
      </button>
      {open ? (
        <div
          className="space-y-1 border-t border-border/40 pt-1 text-2xs text-muted-foreground"
          data-testid="protection-chip-detail"
        >
          <ul className="flex flex-wrap gap-1">
            {view.segments.map((seg) => (
              <li
                key={seg}
                className="rounded bg-background/80 px-1.5 py-0.5"
                data-segment={seg}
              >
                {t(SEGMENT_KEYS[seg] ?? seg)}
              </li>
            ))}
          </ul>
          <p className="font-mono break-all opacity-80" title={t("protection.expand")}>
            {view.diagnosticsArgs.join(" ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
