/**
 * T5: soft first-use "Trust this folder for project tools?"
 */
import { ShieldCheck } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { shortPath } from "@/lib/format";
import { cn } from "@/lib/utils";

export function FolderTrustPrompt(props: {
  folderPath: string;
  onTrust: () => void;
  onNotNow: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3",
        props.className,
      )}
      role="region"
      aria-label={t("folderTrust.title")}
      data-testid="folder-trust-prompt"
    >
      <div className="flex flex-wrap items-start gap-3">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t("folderTrust.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("folderTrust.body", {
              path: shortPath(props.folderPath) || props.folderPath,
            })}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={props.onNotNow}
            data-testid="folder-trust-not-now"
          >
            {t("folderTrust.notNow")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={props.onTrust}
            data-testid="folder-trust-confirm"
          >
            {t("folderTrust.trust")}
          </Button>
        </div>
      </div>
    </div>
  );
}
