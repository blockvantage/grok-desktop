import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import type { WhatsNewItem } from "@/lib/whats-new";

export function WhatsNewDialog(props: {
  open: boolean;
  entries: WhatsNewItem[];
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const dismissed = useRef(false);

  useEffect(() => {
    if (props.open) dismissed.current = false;
  }, [props.open]);

  const close = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    props.onDismiss();
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
        else props.onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-md" data-testid="whats-new">
        <DialogHeader>
          <DialogTitle>{t("whatsNew.title")}</DialogTitle>
          <DialogDescription>{t("whatsNew.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {props.entries.map((entry) => (
            <section key={`${entry.source}-${entry.version}`}>
              <div className="mb-1 flex items-center gap-2">
                <p className="text-sm font-medium">{t(entry.titleKey)}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                  {entry.source === "desk"
                    ? t("whatsNew.deskBadge")
                    : t("whatsNew.runtimeBadge")}
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                {entry.itemKeys.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            data-testid="whats-new-dismiss"
            onClick={close}
          >
            {t("whatsNew.gotIt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
