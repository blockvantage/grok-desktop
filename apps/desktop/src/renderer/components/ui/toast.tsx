import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { t as translate } from "@/i18n/active";

export type ToastVariant = "default" | "destructive" | "success";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastInput = {
  title?: string;
  description: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Pass 0 to keep it until dismissed. */
  duration?: number;
  /** Optional primary action (e.g. Undo). */
  action?: ToastAction;
};

type ToastItem = ToastInput & { id: number; leaving: boolean };

type ToastApi = {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 5000;
const EXIT_MS = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setItems((prev) =>
        prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
      );
      const handle = timers.current.get(id);
      if (handle) clearTimeout(handle);
      const exit = setTimeout(() => remove(id), EXIT_MS);
      timers.current.set(id, exit);
    },
    [remove],
  );

  const schedule = useCallback(
    (id: number, duration: number) => {
      if (duration <= 0) return;
      const handle = timers.current.get(id);
      if (handle) clearTimeout(handle);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const toast = useCallback(
    (input: ToastInput) => {
      const duration = input.duration ?? DEFAULT_DURATION;
      // SC-3: de-dupe identical description (and title) so probe loops cannot storm.
      let reusedId: number | null = null;
      setItems((prev) => {
        const match = prev.find(
          (t) =>
            !t.leaving &&
            t.description === input.description &&
            (t.title ?? "") === (input.title ?? "") &&
            (t.variant ?? "default") === (input.variant ?? "default"),
        );
        if (match) {
          reusedId = match.id;
          return prev;
        }
        const id = ++seq.current;
        reusedId = id;
        const next: ToastItem[] = [
          ...prev,
          { ...input, id, leaving: false },
        ];
        // Cap visible toasts (~4); drop oldest non-leaving entries first.
        const live = next.filter((t) => !t.leaving);
        if (live.length <= 4) return next;
        const dropIds = new Set(
          live.slice(0, live.length - 4).map((t) => t.id),
        );
        return next.filter((t) => !dropIds.has(t.id) || t.id === id);
      });
      const id = reusedId ?? seq.current;
      schedule(id, duration);
      return id;
    },
    [schedule],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport
        items={items}
        onDismiss={dismiss}
        onPause={(id) => {
          const handle = timers.current.get(id);
          if (handle) clearTimeout(handle);
        }}
        onResume={(id, duration) => schedule(id, duration ?? DEFAULT_DURATION)}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const VARIANT_ICON = {
  default: Info,
  destructive: AlertCircle,
  success: CheckCircle2,
} as const;

const VARIANT_ACCENT = {
  default: "text-primary",
  destructive: "text-destructive-text",
  success: "text-success",
} as const;

function ToastViewport({
  items,
  onDismiss,
  onPause,
  onResume,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number, duration?: number) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2.5"
      role="region"
      aria-label={translate("toast.regionLabel")}
    >
      {items.map((t) => {
        const Icon = VARIANT_ICON[t.variant ?? "default"];
        return (
          <div
            key={t.id}
            role="status"
            aria-live={t.variant === "destructive" ? "assertive" : "polite"}
            onMouseEnter={() => onPause(t.id)}
            onMouseLeave={() => onResume(t.id, t.duration)}
            className={cn(
              "surface-float pointer-events-auto flex items-start gap-3 p-3.5",
              t.leaving ? "animate-toast-out" : "animate-toast-in",
            )}
          >
            <Icon
              className={cn(
                "mt-px h-4 w-4 shrink-0",
                VARIANT_ACCENT[t.variant ?? "default"],
              )}
              strokeWidth={1.75}
            />
            <div className="min-w-0 flex-1">
              {t.title && (
                <div className="text-sm font-semibold tracking-tight text-foreground">
                  {t.title}
                </div>
              )}
              <div
                className={cn(
                  "text-sm leading-relaxed text-muted-foreground",
                  t.title && "mt-0.5",
                )}
              >
                {t.description}
              </div>
              {t.action && (
                <button
                  type="button"
                  className="mt-1.5 text-xs font-semibold text-primary hover:underline"
                  onClick={() => {
                    t.action?.onClick();
                    onDismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label={translate("toast.dismiss")}
              onClick={() => onDismiss(t.id)}
              className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
