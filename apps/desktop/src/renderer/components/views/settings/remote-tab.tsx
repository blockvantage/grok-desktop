import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  Link2,
  MonitorSmartphone,
  RefreshCw,
  ShieldOff,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/empty-state";
import { useT } from "@/i18n";
import { rpc, subscribeGatewayNotify } from "@/lib/api";
import {
  DEFAULT_RELAY_URL,
  formatDeviceLastSeenRelative,
  formatPairingCountdown,
  isDeviceActive,
  normalizeRelayUrlInput,
  pairingSecondsRemaining,
  resolveWorkingRelayUrl,
} from "@/lib/remote-ui";
import { cn } from "@/lib/utils";

type RemoteStatus = {
  enabled: boolean;
  relayUrl: string;
  machineId: string;
  deviceCount: number;
  relayConnected?: boolean;
  telepresence?: {
    active: boolean;
    deviceId: string | null;
    quality: string;
    lastError?: string | null;
    framesSent?: number;
  };
};

type DeviceRow = {
  id: string;
  label: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

const PAIR_TTL_MS = 120_000;

export function RemoteTab() {
  const t = useT();
  const { toast } = useToast();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [qr, setQr] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Pairing deep-link includes pairSecret — hide plaintext until user reveals. */
  const [qrRevealed, setQrRevealed] = useState(false);
  /** SC-12: kind drives color; never regex-match translated copy. */
  const [relayProbe, setRelayProbe] = useState<{
    kind: "ok" | "warn";
    message: string;
  } | null>(null);
  /** SC-3: toast status failure once; ongoing failure lives in probe UI. */
  const hasToastedStatusFailRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const st = (await rpc("remote.status", {})) as RemoteStatus;
      setStatus(st);
      const list = (await rpc("remote.devices.list", {})) as DeviceRow[];
      setDevices(Array.isArray(list) ? list : []);
      hasToastedStatusFailRef.current = false;
      return st;
    } catch (e) {
      if (!hasToastedStatusFailRef.current) {
        hasToastedStatusFailRef.current = true;
        toast({
          title: t("settings.remote.toastStatusFailed"),
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
      return null;
    }
  }, [toast, t]);

  /**
   * Pick a *working* Grok Desk relay URL.
   * Never leave the field on :8787 if that port is a foreign service
   * (common on this machine — another app answers /health there).
   *
   * Prefer the main-process connection truth when already Connected:
   * renderer HTTP probes can fail under CSP even when the relay WS is fine.
   */
  const syncRelayUrl = useCallback(
    async (st: RemoteStatus | null) => {
      const preferred =
        st?.relayUrl?.trim() ||
        normalizeRelayUrlInput(relayUrl) ||
        DEFAULT_RELAY_URL;

      // Backend already has a live relay session — trust its URL, skip fetch probe.
      if (st?.enabled && st.relayConnected && st.relayUrl?.trim()) {
        const url = normalizeRelayUrlInput(st.relayUrl);
        setRelayUrl(url);
        setRelayProbe({
          kind: "ok",
          message: t("settings.remote.relayHealthy"),
        });
        return { ok: true as const, url };
      }

      const found = await resolveWorkingRelayUrl(preferred);
      if (!found.ok) {
        // If desk WS is up, do not scare the user with a renderer-only probe failure.
        if (st?.enabled && st.relayConnected) {
          const url = normalizeRelayUrlInput(st.relayUrl || preferred);
          setRelayUrl(url);
          setRelayProbe({
            kind: "ok",
            message: t("settings.remote.relayHealthy"),
          });
          return { ok: true as const, url };
        }
        setRelayProbe({
          kind: "warn",
          message: t("settings.remote.relayUnreachable", {
            reason: found.reason,
          }),
        });
        // Prefer backend-configured URL over the hard-coded default when enabled
        if (st?.enabled && st.relayUrl?.trim()) {
          setRelayUrl(normalizeRelayUrlInput(st.relayUrl));
        } else if (!st?.enabled) {
          setRelayUrl(preferred);
        }
        return found;
      }
      setRelayUrl(found.url);
      const preferredN = normalizeRelayUrlInput(preferred);
      if (found.url !== preferredN) {
        setRelayProbe({
          kind: "ok",
          message: t("settings.remote.relayAutoSwitched", { url: found.url }),
        });
        // If remote was enabled against a dead/wrong port, re-bind to the good relay
        if (st?.enabled) {
          try {
            await rpc("remote.enable", { relayUrl: found.url });
            await refresh();
            toast({
              title: t("settings.remote.toastEnabled"),
              description: t("settings.remote.relayAutoSwitched", {
                url: found.url,
              }),
            });
          } catch (e) {
            toast({
              title: t("settings.remote.toastEnableFailed"),
              description: e instanceof Error ? e.message : String(e),
              variant: "destructive",
            });
          }
        }
      } else {
        setRelayProbe({
          kind: "ok",
          message: t("settings.remote.relayHealthy"),
        });
      }
      return found;
    },
    [relayUrl, refresh, t, toast],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const st = await refresh();
      if (cancelled) return;
      await syncRelayUrl(st);
    })();
    return () => {
      cancelled = true;
    };
    // mount only — avoid fighting user edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CX-12: phone tried expired/reused QR — show desk toast so user regenerates QR
  useEffect(() => {
    return subscribeGatewayNotify((msg) => {
      if (msg.method !== "notify.pairAttemptFailed") return;
      const reason =
        msg.params &&
        typeof msg.params === "object" &&
        "reason" in msg.params
          ? String((msg.params as { reason?: string }).reason)
          : "unknown";
      toast({
        title: t("settings.remote.toastPairAttemptFailed"),
        description:
          reason === "expired"
            ? t("settings.remote.toastPairExpired")
            : t("settings.remote.toastPairInvalid"),
        variant: "destructive",
      });
    });
  }, [t, toast]);

  // Probe loop with backoff while disconnected (2.5s → 10s after failed rounds).
  useEffect(() => {
    if (!status?.enabled) return;
    let cancelled = false;
    let failRounds = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      const st = await refresh();
      if (cancelled) return;
      if (st && !st.relayConnected) {
        failRounds += 1;
        await syncRelayUrl(st);
      } else {
        failRounds = 0;
        if (st?.relayUrl) {
          setRelayUrl(normalizeRelayUrlInput(st.relayUrl));
        }
      }
      const delay = failRounds >= 5 ? 10_000 : 2500;
      timer = setTimeout(() => {
        void tick();
      }, delay);
    };
    timer = setTimeout(() => {
      void tick();
    }, 2500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status?.enabled, refresh, syncRelayUrl]);

  // Pairing countdown + relative last-seen tick
  useEffect(() => {
    if (!qrExpiresAt && devices.length === 0) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [qrExpiresAt, devices.length]);

  useEffect(() => {
    if (!qr) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(qr, {
      width: 220,
      margin: 2,
      // Midnight + cloud (Deep Navy + Ice) QR modules
      color: { dark: "#050e21", light: "#f3f7fb" },
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qr]);

  const secondsLeft = pairingSecondsRemaining(qrExpiresAt, nowTick);
  useEffect(() => {
    if (qrExpiresAt != null && secondsLeft <= 0) {
      setQr(null);
      setQrExpiresAt(null);
    }
  }, [qrExpiresAt, secondsLeft]);

  const activeDevices = useMemo(
    () => devices.filter((d) => isDeviceActive(d)),
    [devices],
  );
  const revokedDevices = useMemo(
    () => devices.filter((d) => !isDeviceActive(d)),
    [devices],
  );

  const enable = async () => {
    setBusy(true);
    try {
      let url = normalizeRelayUrlInput(relayUrl);
      // Best-effort discover a real Grok Desk relay. Renderer fetch can fail
      // under CSP; in that case fall through and let main-process WS decide.
      const alt = await resolveWorkingRelayUrl(url);
      if (alt.ok) {
        url = alt.url;
        setRelayUrl(url);
        setRelayProbe({
          kind: "ok",
          message: t("settings.remote.relayHealthy"),
        });
      }
      await rpc("remote.enable", {
        relayUrl: url,
      });
      const st = await refresh();
      if (st?.relayConnected) {
        setRelayUrl(normalizeRelayUrlInput(st.relayUrl || url));
        setRelayProbe({
          kind: "ok",
          message: t("settings.remote.relayHealthy"),
        });
      } else if (!alt.ok) {
        setRelayProbe({
          kind: "warn",
          message: t("settings.remote.relayUnreachable", {
            reason: alt.reason,
          }),
        });
      }
      toast({ description: t("settings.remote.toastEnabled") });
    } catch (e) {
      toast({
        title: t("settings.remote.toastEnableFailed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await rpc("remote.disable", {});
      setQr(null);
      setQrExpiresAt(null);
      await refresh();
      toast({ description: t("settings.remote.toastDisabled") });
    } catch (e) {
      toast({
        title: t("settings.remote.toastDisableFailed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const showQr = async () => {
    setBusy(true);
    try {
      if (!status?.enabled) {
        throw new Error(t("settings.remote.enableFirst"));
      }
      // Prefer live main-process WS status over renderer HTTP /health.
      // Browser fetch is often blocked by CSP ("Failed to fetch") even when
      // RELAY shows Connected — do not block pairing on that false negative.
      let st = status;
      if (!st.relayConnected) {
        const preferred =
          st.relayUrl || normalizeRelayUrlInput(relayUrl) || DEFAULT_RELAY_URL;
        const found = await resolveWorkingRelayUrl(preferred);
        if (found.ok) {
          await rpc("remote.enable", { relayUrl: found.url });
          setRelayUrl(found.url);
          st = (await refresh()) ?? st;
        }
        // Give the session host a moment to finish hello after rebind
        if (!st?.relayConnected) {
          await new Promise((r) => setTimeout(r, 600));
          st = (await refresh()) ?? st;
        }
      } else if (st.relayUrl) {
        setRelayUrl(normalizeRelayUrlInput(st.relayUrl));
        setRelayProbe({
          kind: "ok",
          message: t("settings.remote.relayHealthy"),
        });
      }
      // Pairing is a local gateway RPC; only hard-fail when enabled but we
      // still have no session after the rebind attempt above.
      if (!st?.relayConnected) {
        throw new Error(
          t("settings.remote.relayUnreachable", {
            reason: "desk is not connected to the relay",
          }),
        );
      }
      const res = (await rpc("remote.pairing.start", {
        ttlMs: PAIR_TTL_MS,
      })) as { qrString: string; expiresAt?: string };
      if (!res?.qrString || !String(res.qrString).includes("grokdesk://pair")) {
        throw new Error(t("settings.remote.toastPairingFailed"));
      }
      setQr(res.qrString);
      setQrRevealed(false);
      const exp = res.expiresAt
        ? Date.parse(res.expiresAt)
        : Date.now() + PAIR_TTL_MS;
      setQrExpiresAt(Number.isFinite(exp) ? exp : Date.now() + PAIR_TTL_MS);
      setCopied(false);
      // Pre-render QR so UI never flashes empty longer than needed
      const dataUrl = await QRCode.toDataURL(res.qrString, {
        width: 220,
        margin: 2,
        color: { dark: "#050e21", light: "#f3f7fb" },
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(dataUrl);
      toast({ description: t("settings.remote.toastQrReady") });
    } catch (e) {
      toast({
        title: t("settings.remote.toastPairingFailed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const copyQr = async () => {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(qr);
      setCopied(true);
      toast({ description: t("settings.remote.toastCopied") });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ description: t("settings.remote.toastCopyFailed") });
    }
  };

  const stopTelepresence = async () => {
    setBusy(true);
    try {
      await rpc("remote.telepresence.stop", {});
      await refresh();
      toast({ description: t("settings.remote.toastTeleStopped") });
    } catch (e) {
      toast({
        title: t("settings.remote.toastTeleStopFailed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (deviceId: string) => {
    setBusy(true);
    try {
      await rpc("remote.devices.revoke", { deviceId });
      await refresh();
      toast({ description: t("settings.remote.toastRevoked") });
    } catch (e) {
      toast({
        title: t("settings.remote.toastRevokeFailed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-1">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">
          {t("settings.remote.title")}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-xl text-xs leading-relaxed">
          {t("settings.remote.subtitle")}
        </p>
      </div>

      {/* Status strip */}
      <div className="grid gap-2 sm:grid-cols-3">
        <StatusChip
          icon={
            status?.enabled ? (
              <Link2 className="h-3.5 w-3.5" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" />
            )
          }
          label={t("settings.remote.chipAccess")}
          value={
            status?.enabled
              ? t("settings.remote.enabled")
              : t("settings.remote.disabled")
          }
          tone={status?.enabled ? "good" : "muted"}
        />
        <StatusChip
          icon={
            status?.relayConnected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )
          }
          label={t("settings.remote.chipRelay")}
          value={
            !status?.enabled
              ? "—"
              : status.relayConnected
                ? t("settings.remote.relayConnected")
                : t("settings.remote.relayConnecting")
          }
          tone={
            !status?.enabled
              ? "muted"
              : status.relayConnected
                ? "good"
                : "warn"
          }
        />
        <StatusChip
          icon={<Smartphone className="h-3.5 w-3.5" />}
          label={t("settings.remote.chipDevices")}
          value={String(activeDevices.length)}
          tone={activeDevices.length > 0 ? "good" : "muted"}
        />
      </div>

      {status?.telepresence?.active && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ring/40 bg-gradient-to-r from-ring/15 to-ring/5 px-4 py-3"
          role="status"
        >
          <div className="flex min-w-0 items-start gap-3">
            <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-ring" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ring">
                {t("settings.remote.teleLiveTitle")}
              </div>
              <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                {t("settings.remote.teleLiveBody", {
                  device: status.telepresence.deviceId ?? "device",
                  quality: status.telepresence.quality,
                })}
                {typeof status.telepresence.framesSent === "number" &&
                  status.telepresence.framesSent > 0 && (
                    <span>
                      {" "}
                      · {status.telepresence.framesSent} frame(s)
                    </span>
                  )}
              </p>
              {status.telepresence.lastError && (
                <p className="mt-1 text-2xs text-destructive-text">
                  {t("settings.remote.teleError", {
                    error: status.telepresence.lastError,
                  })}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-ring/40"
              disabled={busy}
              onClick={() => {
                void window.grokdesk?.desktop?.openCaptureSettings?.();
              }}
            >
              {t("settings.remote.openCaptureSettings")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-ring/40"
              disabled={busy}
              onClick={() => void stopTelepresence()}
            >
              {t("settings.remote.stopTele")}
            </Button>
          </div>
        </div>
      )}

      {/* Relay URL — SC-1: tokenized panel, no raw white/[0.06] */}
      <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-4">
        <label className="text-xs font-medium">
          {t("settings.remote.relayUrl")}
        </label>
        <Input
          value={relayUrl}
          onChange={(e) => {
            setRelayUrl(e.target.value);
            setRelayProbe(null);
          }}
          placeholder="ws://127.0.0.1:8788"
          disabled={busy || Boolean(status?.enabled)}
          className="font-mono text-xs"
        />
        <p className="text-muted-foreground text-2xs leading-relaxed">
          {t("settings.remote.relayHint")}
        </p>
        {relayProbe && (
          <p
            className={cn(
              "font-mono text-2xs leading-relaxed",
              relayProbe.kind === "warn"
                ? "text-warning"
                : "text-success",
            )}
          >
            {relayProbe.message}
          </p>
        )}
        {status?.machineId && (
          <p className="text-muted-foreground font-mono text-2xs">
            {t("settings.remote.machineId", { id: status.machineId })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!status?.enabled ? (
          <Button size="sm" onClick={() => void enable()} disabled={busy}>
            {t("settings.remote.enable")}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void showQr()}
              disabled={busy}
            >
              {qr ? t("settings.remote.refreshQr") : t("settings.remote.showQr")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void disable()}
              disabled={busy}
            >
              {t("settings.remote.disable")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.remote.refreshDevices")}
            </Button>
          </>
        )}
      </div>

      {/* Pairing card */}
      {qr && secondsLeft > 0 && (
        <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold">
                {t("settings.remote.scanTitle")}
              </p>
              <p className="text-muted-foreground mt-0.5 text-2xs">
                {t("settings.remote.scanHint")}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 font-mono text-2xs tabular-nums",
                secondsLeft <= 20
                  ? "bg-warning/15 text-warning"
                  : "bg-white/10 text-muted-foreground",
              )}
            >
              {t("settings.remote.expiresIn", {
                time: formatPairingCountdown(secondsLeft),
              })}
            </span>
          </div>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-xl bg-white p-3 shadow-lg shadow-black/20">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t("settings.remote.qrAlt")}
                  width={200}
                  height={200}
                  className="block h-[200px] w-[200px]"
                />
              ) : (
                <div className="bg-muted h-[200px] w-[200px] animate-pulse rounded" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <textarea
                className="bg-muted/40 w-full resize-y rounded-lg border border-white/10 p-2.5 font-mono text-2xs leading-snug"
                rows={5}
                readOnly
                // Pairing URL embeds pairSecret — mask until explicit reveal.
                value={
                  qrRevealed
                    ? qr
                    : "••••••••••••••••••••••••••••••••••••••••••••••••"
                }
                data-pairing-link-masked={!qrRevealed ? "true" : "false"}
                aria-label={t("settings.remote.copyLink")}
                onFocus={(e) => {
                  if (qrRevealed) e.currentTarget.select();
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8"
                  onClick={() => void copyQr()}
                >
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied
                    ? t("settings.remote.copied")
                    : t("settings.remote.copyLink")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  type="button"
                  data-pairing-reveal-toggle
                  onClick={() => setQrRevealed((v) => !v)}
                >
                  {qrRevealed
                    ? t("settings.remote.hidePairingLink")
                    : t("settings.remote.showPairingLink")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => void showQr()}
                  disabled={busy}
                >
                  {t("settings.remote.refreshQr")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Devices */}
      <div>
        <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("settings.remote.devices")}
        </h4>
        {devices.length === 0 ? (
          <EmptyState
            icon={<Smartphone className="h-5 w-5" />}
            title={t("settings.remote.noDevices")}
            description={
              status?.enabled
                ? t("settings.remote.noDevicesHint")
                : undefined
            }
            className="py-6 sm:py-8"
          />
        ) : (
          <ul className="space-y-2">
            {activeDevices.map((d) => (
              <DeviceRowItem
                key={d.id}
                device={d}
                nowTick={nowTick}
                busy={busy}
                onRevoke={() => void revoke(d.id)}
                t={t}
              />
            ))}
            {revokedDevices.map((d) => (
              <DeviceRowItem
                key={d.id}
                device={d}
                nowTick={nowTick}
                busy={busy}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusChip(props: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "good" | "warn" | "muted";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-muted-foreground flex items-center gap-1.5 text-2xs uppercase tracking-wide">
        {props.icon}
        {props.label}
      </div>
      <div
        className={cn(
          "mt-1 text-sm font-medium capitalize",
          props.tone === "good" && "text-success",
          props.tone === "warn" && "text-warning",
          props.tone === "muted" && "text-muted-foreground",
        )}
      >
        {props.value}
      </div>
    </div>
  );
}

function DeviceRowItem(props: {
  device: DeviceRow;
  nowTick: number;
  busy: boolean;
  onRevoke?: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const active = isDeviceActive(props.device);
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs",
        active
          ? "border-border/60 bg-card/40"
          : "border-border/40 bg-transparent opacity-60",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <Smartphone className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="truncate">{props.device.label}</span>
          {!active && (
            <span className="text-muted-foreground shrink-0 text-2xs">
              {props.t("settings.remote.revoked")}
            </span>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 pl-5 text-2xs">
          {props.t("settings.remote.lastSeen", {
            when: formatDeviceLastSeenRelative(
              props.device.lastSeenAt,
              props.nowTick,
            ),
          })}
        </div>
        <div className="text-muted-foreground mt-0.5 truncate pl-5 font-mono text-2xs">
          {props.device.id}
        </div>
      </div>
      {active && props.onRevoke && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="destructive"
              className="h-8 shrink-0"
              disabled={props.busy}
            >
              {props.t("settings.remote.revoke")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {props.t("settings.remote.revoke")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {props.device.label}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{props.t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => props.onRevoke?.()}
              >
                {props.t("settings.remote.revoke")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}
