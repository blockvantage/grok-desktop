/**
 * Owned AlertDialog replacement for window.confirm().
 */
import { useCallback, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type OwnedConfirmOptions = {
  title: string;
  description: string;
  items?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = OwnedConfirmOptions & {
  resolve: (ok: boolean) => void;
};

export function useOwnedConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback((opts: OwnedConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const dialog = useMemo(() => {
    if (!pending) return null;
    const close = (ok: boolean) => {
      pending.resolve(ok);
      setPending(null);
    };
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <AlertDialogContent data-testid="owned-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {pending.items && pending.items.length > 0 ? (
            <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-foreground/90">
              {pending.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {pending.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              className={pending.destructive ? "bg-destructive text-destructive-foreground" : undefined}
              onClick={() => close(true)}
            >
              {pending.confirmLabel ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }, [pending]);

  return { ask, dialog };
}
