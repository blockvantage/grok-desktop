import { useCallback, useEffect, useState } from "react";
import { MonitorSmartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rpc, subscribeGatewayNotify } from "@/lib/api";
import { useT } from "@/i18n";

type TeleState = {
  active: boolean;
  deviceId: string | null;
  quality: string;
};

/**
 * App-wide strip when a phone is remotely controlling the desk.
 * Polls remote.status; low-noise so it can sit under the top bar.
 */
export function RemoteControlBanner() {
  const t = useT();
  const [tele, setTele] = useState<TeleState | null>(null);
  const [busy, setBusy] = useState(false);

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const st = (await rpc("remote.status", {})) as {
        enabled?: boolean;
        telepresence?: TeleState;
      };
      setTele(st.telepresence?.active ? st.telepresence : null);
      return Boolean(st.enabled);
    } catch {
      setTele(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      // Boot once; push + slow safety net while remote is enabled.
      const enabled = await poll();
      if (cancelled || !enabled) return;
      timer = setInterval(() => {
        void (async () => {
          const still = await poll();
          if (!still && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        })();
      }, 30_000);
    })();
    const unsub = subscribeGatewayNotify((msg) => {
      if (msg.method === "notify.remoteChanged") void poll();
    });
    return () => {
      cancelled = true;
      unsub();
      if (timer) clearInterval(timer);
    };
  }, [poll]);

  if (!tele?.active) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-ring/30 bg-gradient-to-r from-ring/15 via-ring/10 to-transparent px-4 py-2 text-xs text-ring"
    >
      <div className="flex min-w-0 items-center gap-2">
        <MonitorSmartphone className="h-3.5 w-3.5 shrink-0 text-ring" />
        <span className="truncate font-medium">
          {t("settings.remote.teleLiveTitle")}
        </span>
        <span className="hidden truncate text-muted-foreground sm:inline">
          {t("settings.remote.teleLiveBody", {
            device: tele.deviceId ?? "device",
            quality: tele.quality,
          })}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 border-ring/40 bg-transparent px-2 text-2xs"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void rpc("remote.telepresence.stop", {})
            .then(() => poll())
            .finally(() => setBusy(false));
        }}
      >
        <X className="mr-1 h-3 w-3" />
        {t("settings.remote.stopTele")}
      </Button>
    </div>
  );
}
