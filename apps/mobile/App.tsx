import "react-native-get-random-values";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Image,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  Banner,
  Badge,
  Btn,
  BusyOverlay,
  Card,
  Chip,
  EmptyState,
  Field,
  GroupLabel,
  HeroMark,
  ListRow,
  MoreNav,
  ScreenHeader,
  SectionTitle,
  Segmented,
  StatStrip,
  StatusPill,
  ToastBar,
  ToggleRow,
} from "./src/ui/components";
import { Icon } from "./src/ui/Icon";
import { FadeIn, SkeletonList, usePulse } from "./src/ui/motion";
import { colors, radius, shadow, space, type as typo } from "./src/ui/theme";
import { haptic } from "./src/lib/haptics";
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession,
} from "./src/storage/session";
import {
  clearOfflineQueue,
  loadOfflineQueue,
  saveOfflineQueue,
} from "./src/storage/offline-queue";
import {
  pairWithQr,
  RemoteGatewayClient,
} from "./src/api/remote-client";
import type {
  ConnectionModel,
  TelepresenceQuality,
} from "@grokdesk/shared/remote";
import { PairScreen, type PairStep } from "./src/screens/PairScreen";
import { I18nProvider, useI18n, type LocalePreference } from "./src/i18n";
import {
  DEFAULT_PREFS,
  diffNewInboxIds,
  loadPrefs,
  savePrefs,
  type MobileRemotePrefs,
} from "./src/storage/prefs";
import { composeTaskGoal } from "./src/lib/compose-goal";
import {
  ensureBiometricUnlock,
  getBiometricStatus,
} from "./src/lib/biometric";
import { setDeskKeepAwake } from "./src/lib/keep-awake";
import { notifyLocal } from "./src/lib/local-notify";
import { classifyRemoteError } from "@grokdesk/shared/remote";

function memoryKindLabel(
  k: string,
  t: (key: string) => string,
): string {
  const map: Record<string, string> = {
    all: "memory.kindAll",
    profile: "memory.kindProfile",
    project: "memory.kindProject",
    brand: "memory.kindBrand",
    preference: "memory.kindPreference",
    episodic: "memory.kindEpisodic",
    now: "memory.kindNow",
    standing: "memory.kindStanding",
  };
  return t(map[k] ?? "memory.kindAll");
}

type Tab =
  | "home"
  | "tasks"
  | "inbox"
  | "desk"
  | "schedule"
  | "memory"
  | "settings"
  | "pair";

type DisplayInfo = {
  id: string;
  label: string;
  width: number;
  height: number;
  isPrimary?: boolean;
};

type MemoryKind =
  | "profile"
  | "project"
  | "brand"
  | "preference"
  | "episodic"
  | "now"
  | "standing";

type ScheduleRule = {
  id: string;
  name: string;
  goalTemplate?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
};

type MemoryItem = {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
};

const MEMORY_KINDS: Array<MemoryKind | "all"> = [
  "all",
  "profile",
  "project",
  "brand",
  "preference",
  "episodic",
  "now",
  "standing",
];

function createBrowserWs(url: string) {
  return new WebSocket(url) as unknown as import("./src/api/remote-client").WsLike;
}

function formatElapsed(ms: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return t("tasks.elapsed", { m, s: String(s).padStart(2, "0") });
}

function taskStartMs(task: {
  createdAt?: string | number;
  updatedAt?: string | number;
}): number | null {
  const raw = task.updatedAt ?? task.createdAt;
  if (raw == null) return null;
  if (typeof raw === "number") return raw < 1e12 ? raw * 1000 : raw;
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? n : null;
}


// Hold the dark splash until session restore finishes (PM-1).
void SplashScreen.preventAutoHideAsync().catch(() => {
  /* Expo Go / web may not support */
});

const TAB_BAR_CONTENT_HEIGHT = 56;
const REKEY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppInner />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function AppInner() {
  const { t, locales, preference, setLocale, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const tabBarPadBottom = Math.max(insets.bottom, 12);
  const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + tabBarPadBottom;
  const pipBottom = tabBarHeight + 12;
  const livePulse = usePulse(true);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [tab, setTab] = useState<Tab>("pair");
  const [status, setStatus] = useState("");
  const [bootReady, setBootReady] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsets = useRef<Partial<Record<Tab, number>>>({});
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [pairStep, setPairStep] = useState<PairStep>(0);
  const [statusKind, setStatusKind] = useState<"error" | "info">("info");
  const [queueItems, setQueueItems] = useState<
    Array<{ id: string; method: string; createdAt: number }>
  >([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const pairAbortRef = useRef(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [homeAdvanced, setHomeAdvanced] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: "neutral" | "ok" | "warn" | "danger";
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (
      message: string,
      tone: "neutral" | "ok" | "warn" | "danger" = "neutral",
    ) => {
      setToast({ message, tone });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4200);
    },
    [],
  );

  const tabTitle = useMemo(() => {
    const map: Partial<Record<Tab, string>> = {
      home: t("home.title"),
      tasks: t("tasks.title"),
      desk: t("desk.title"),
      inbox: t("inbox.title"),
      schedule: t("schedule.title"),
      memory: t("memory.title"),
      settings: t("settings.title"),
      pair: t("pair.title"),
    };
    return map[tab] ?? t("app.name");
  }, [tab, t]);
  // localize idle once translator is ready
  useEffect(() => {
    if (!status) setStatus(t("app.statusIdle"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const [connModel, setConnModel] = useState<ConnectionModel>({
    state: "offline",
    attempt: 0,
    lastError: null,
    queueError: null,
    label: "Offline", // localized when conn model updates
  });
  const memKindFilterRef = useRef<MemoryKind | "all">("all");
  const [tasks, setTasks] = useState<
    Array<{
      id: string;
      goal?: string;
      status?: string;
      title?: string;
      createdAt?: string | number;
      updatedAt?: string | number;
    }>
  >([]);
  const [inbox, setInbox] = useState<
    Array<{
      id: string;
      title?: string;
      body?: string;
      kind?: string;
      taskId?: string | null;
    }>
  >([]);
  const [schedules, setSchedules] = useState<ScheduleRule[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [schedName, setSchedName] = useState("");
  const [schedGoal, setSchedGoal] = useState("");
  const [schedCron, setSchedCron] = useState("0 9 * * 1-5");
  const [schedTz, setSchedTz] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memLoading, setMemLoading] = useState(false);
  const [memError, setMemError] = useState<string | null>(null);
  const [memKindFilter, setMemKindFilter] = useState<MemoryKind | "all">("all");
  const [memTitle, setMemTitle] = useState("");
  const [memContent, setMemContent] = useState("");
  const [memKind, setMemKind] = useState<MemoryKind>("preference");
  const [memEditId, setMemEditId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [eventAfterSeq, setEventAfterSeq] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [approvalBanner, setApprovalBanner] = useState<{
    taskId: string;
    title: string;
  } | null>(null);
  const [pendingApprove, setPendingApprove] = useState<Record<string, boolean>>({});
  const [deskModel, setDeskModel] = useState("grok-4.5");
  const [approvalMode, setApprovalMode] = useState<"cautious" | "balanced" | "fast">("balanced");
  const [followUp, setFollowUp] = useState("");
  const [artifacts, setArtifacts] = useState<Array<{ id: string; name?: string; kind?: string }>>([]);
  const [goal, setGoal] = useState("");
  const [taskNote, setTaskNote] = useState("");
  const [voiceNote, setVoiceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<RemoteGatewayClient | null>(null);
  const [teleUri, setTeleUri] = useState<string | null>(null);
  const [teleQuality, setTeleQuality] = useState<TelepresenceQuality>("auto");
  const [teleLive, setTeleLive] = useState(false);
  const [softKeys, setSoftKeys] = useState("");
  const [deskLayout, setDeskLayout] = useState({ w: 0, h: 0 });
  const [prefs, setPrefs] = useState<MobileRemotePrefs>(DEFAULT_PREFS);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedDisplayId, setSelectedDisplayId] = useState<string | null>(
    null,
  );
  const [notifyBanner, setNotifyBanner] = useState<string | null>(null);
  const [deskDiag, setDeskDiag] = useState<string | null>(null);
  const [pairedDevices, setPairedDevices] = useState<
    Array<{
      id: string;
      label?: string;
      lastSeenAt?: string | null;
      revokedAt?: string | null;
    }>
  >([]);
  const [bioLabel, setBioLabel] = useState("…");
  const [unlocked, setUnlocked] = useState(false);
  /** Session held while biometric lock is engaged (not exposed to tabs until unlock). */
  const [lockedSession, setLockedSession] = useState<StoredSession | null>(null);

  function biometricPassThrough(): boolean {
    if (typeof process !== "undefined" && process.env.VITEST) return true;
    // Expo dev client / simulator may lack hardware
    // eslint-disable-next-line no-undef
    if (typeof __DEV__ !== "undefined" && __DEV__) return true;
    return false;
  }
  const deskGesture = useRef({
    startX: 0,
    startY: 0,
    maxTouches: 1,
  });
  const teleLiveRef = useRef(false);
  const deskLayoutRef = useRef({ w: 0, h: 0 });
  const tabRef = useRef<Tab>("pair");
  const ensureClientRef = useRef<() => Promise<RemoteGatewayClient>>(
    async () => {
      throw new Error("not ready");
    },
  );

  tabRef.current = tab;
  memKindFilterRef.current = memKindFilter;

  /** Pull core desk state so the phone stays in sync without manual refresh. */
  const syncDesk = useCallback(async (c: RemoteGatewayClient) => {
    if (!c.isConnected) return;
    try {
      const [taskList, inboxList] = await Promise.all([
        c.request("tasks.list") as Promise<
          Array<{
            id: string;
            goal?: string;
            status?: string;
            title?: string;
            createdAt?: string | number;
            updatedAt?: string | number;
          }>
        >,
        c.request("inbox.list") as Promise<
          Array<{
            id: string;
            title?: string;
            body?: string;
            kind?: string;
            taskId?: string | null;
          }>
        >,
      ]);
      const tasksArr = Array.isArray(taskList) ? taskList : [];
      setTasks(tasksArr);
      setInbox(Array.isArray(inboxList) ? inboxList : []);
      setLastSyncedAt(Date.now());
      // CX-6 / UX-15: desk default model
      try {
        const models = (await c.request("models.list")) as Array<{
          id?: string;
          default?: boolean;
        }>;
        if (Array.isArray(models) && models.length > 0) {
          const def =
            models.find((m) => m.default) ??
            models.find((m) => m.id?.includes("grok")) ??
            models[0];
          if (def?.id) setDeskModel(def.id);
        }
      } catch {
        /* models.list optional */
      }
      // CX-3: surface pending approvals from task status (gated on prefs)
      const prefsSnap = await loadPrefs();
      if (prefsSnap.notifyApprovals) {
        const pending = tasksArr.find(
          (tk) =>
            tk.status === "approval_required" ||
            tk.status === "awaiting_approval",
        );
        if (pending) {
          setApprovalBanner({
            taskId: pending.id,
            title: pending.title || pending.goal || pending.id,
          });
        } else {
          setApprovalBanner(null);
        }
      }
    } catch {
      /* best-effort sync */
    }
    const t = tabRef.current;
    try {
      if (t === "schedule") await refreshSchedulesInternal(c);
      else if (t === "memory") {
        await refreshMemoryInternal(c, memKindFilterRef.current);
      }
    } catch {
      /* tab-specific resume is best-effort */
    }
  }, []);

  /** Refresh list for the active tab after any path that reaches Online (incl. auto-reconnect). */
  const resumeActiveTab = useCallback(
    async (c: RemoteGatewayClient) => {
      await syncDesk(c);
    },
    [syncDesk],
  );

  const selectedTaskRef = useRef<string | null>(null);
  selectedTaskRef.current = selectedTask;
  const eventAfterSeqRef = useRef(0);
  const prevQueueErrorRef = useRef<string | null>(null);
  const refreshQueueItemsRef = useRef<() => Promise<void>>(async () => {});
  eventAfterSeqRef.current = eventAfterSeq;
  const loadEventsIncrementalRef = useRef<
    (c: RemoteGatewayClient, taskId: string) => Promise<void>
  >(async () => {});

  const loadEventsIncremental = useCallback(
    async (c: RemoteGatewayClient, taskId: string) => {
      try {
        const after = eventAfterSeqRef.current;
        const ev = (await c.request("events.list", {
          taskId,
          afterSeq: after,
        })) as Array<{ seq?: number; kind?: string }>;
        if (!Array.isArray(ev) || ev.length === 0) return;
        setEvents((prev) => {
          if (after === 0) return ev;
          return [...prev, ...ev];
        });
        const maxSeq = ev.reduce(
          (m, e) => Math.max(m, typeof e.seq === "number" ? e.seq : m),
          after,
        );
        setEventAfterSeq(maxSeq);
        eventAfterSeqRef.current = maxSeq;
      } catch {
        /* stream is best-effort */
      }
    },
    [],
  );
  loadEventsIncrementalRef.current = loadEventsIncremental;

  const bindClient = useCallback(
    (c: RemoteGatewayClient) => {
      let prevState: ConnectionModel["state"] = c.connection.state;
      c.onConnectionChange((m) => {
        const label =
          m.state === "online"
            ? m.queueError
              ? `${t("conn.online")} — ${m.queueError}`
              : t("conn.online")
            : m.state === "reconnecting"
              ? m.attempt === 0
                ? t("conn.connecting")
                : t("conn.reconnecting")
              : t("conn.offline");
        setConnModel({ ...m, label });
        // UX-1: connection state lives on the pill (connModel); do not dump into dead status
        // Auto-reconnect path: client.connect() only — resume lists when Online is reached
        if (m.state === "online" && prevState !== "online" && c.isConnected) {
          void resumeActiveTab(c);
        }
        // CX-11: queue flush failure → toast + force-refresh lists regardless of tab
        if (m.queueError && m.queueError !== c.connection.queueError) {
          /* handled below via queueError transition */
        }
        if (
          m.queueError &&
          (!prevQueueErrorRef.current || prevQueueErrorRef.current !== m.queueError)
        ) {
          prevQueueErrorRef.current = m.queueError;
          showToast(m.queueError, "danger");
          void resumeActiveTab(c);
          void refreshQueueItemsRef.current();
        }
        if (!m.queueError) prevQueueErrorRef.current = null;
        prevState = m.state;
      });
      // P4: desk revoke / invalid token → wipe local session (use this client, not React state)
      c.onFatalSession((info) => {
        void (async () => {
          try {
            await c.stopTelepresence();
          } catch {
            /* ignore */
          }
          c.close();
          setClient(null);
          setTeleLive(false);
          setTeleUri(null);
          // Drop local secrets + any queued mutations that must not fire post-revoke
          await clearSession();
          await clearOfflineQueue();
          setSession(null);
          setTab("pair");
          setUnlocked(false);
          setStatus(
            info.kind === "revoked"
              ? t("errors.revoked")
              : t("status.sessionEnded", { msg: info.message }),
          );
        })();
      });
      c.enableAutoReconnect(true);
      c.onTeleFrame((f) => {
        setTeleUri(`data:${f.mime};base64,${f.dataB64}`);
      });
      // CX-2: event-driven refresh (mirrors desktop F4 push pattern)
      c.onEvent((ev) => {
        if (
          ev.channel === "notify.tasksChanged" ||
          ev.channel === "notify.inboxChanged" ||
          ev.channel === "notify.remoteChanged"
        ) {
          void resumeActiveTab(c);
        }
        if (ev.channel === "notify.taskEvents") {
          const payload = ev.payload as { taskId?: string } | null;
          const taskId = payload?.taskId;
          if (taskId && selectedTaskRef.current === taskId) {
            void loadEventsIncrementalRef.current(c, taskId);
          }
          // Approvals often arrive as taskEvents — re-sync status
          void resumeActiveTab(c);
        }
      });
      setClient(c);
    },
    [resumeActiveTab, t, showToast],
  );

  const connect = useCallback(
    async (s: StoredSession) => {
      // Reuse existing client instance when possible to avoid socket leaks
      let c = client;
      if (!c || !session || session.deviceId !== s.deviceId) {
        c?.close();
        c = new RemoteGatewayClient(s, createBrowserWs);
        bindClient(c);
      }
      await c.connect();
      // Explicit App.connect also resumes (covers first connect; auto path uses listener)
      await resumeActiveTab(c);
      return c;
    },
    [client, session, bindClient, resumeActiveTab],
  );

  const ensureClient = useCallback(async () => {
    if (client?.isConnected) return client;
    if (!session) throw new Error("Not paired");
    return connect(session);
  }, [client, session, connect]);

  teleLiveRef.current = teleLive;
  deskLayoutRef.current = deskLayout;
  ensureClientRef.current = ensureClient;

  async function refreshSchedulesInternal(c: RemoteGatewayClient) {
    setSchedLoading(true);
    setSchedError(null);
    try {
      const list = (await c.request("schedule.list")) as ScheduleRule[];
      setSchedules(Array.isArray(list) ? list : []);
    } catch (e) {
      setSchedError(e instanceof Error ? e.message : String(e));
    } finally {
      setSchedLoading(false);
    }
  }

  async function refreshMemoryInternal(
    c: RemoteGatewayClient,
    kind: MemoryKind | "all",
  ) {
    setMemLoading(true);
    setMemError(null);
    try {
      const params = kind === "all" ? {} : { kind };
      const list = (await c.request("memory.list", params)) as MemoryItem[];
      setMemories(Array.isArray(list) ? list : []);
    } catch (e) {
      setMemError(e instanceof Error ? e.message : String(e));
    } finally {
      setMemLoading(false);
    }
  }

  // Restore prefs + session and auto-reconnect when the app launches.
  // Hold splash until first restore decision (PM-1) so we never flash white.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await loadPrefs();
        if (cancelled) return;
        setPrefs(p);
        setTeleQuality(p.defaultQuality);
        setSelectedDisplayId(p.preferredDisplayId);
        const bio = await getBiometricStatus();
        if (!cancelled) setBioLabel(bio.label);
        const s = await loadSession();
        if (!s) {
          // Unpaired cold start — hide splash on pair screen
          return;
        }
        if (cancelled) return;
        // P4 biometric gate before restoring paired UI / RPC
        const unlock = await ensureBiometricUnlock({
          enabled: p.biometricLock,
          allowPassThroughWithoutHardware: biometricPassThrough(),
        });
        if (!unlock.ok) {
          setStatus(unlock.reason ?? t("unlock.required"));
          setLockedSession(s);
          setSession(null);
          setUnlocked(false);
          setTab("pair");
          return;
        }
        if (cancelled) return;
        setUnlocked(true);
        setLockedSession(null);
        setSession(s);
        setTab("home");
        setStatus(t("status.reconnecting"));
        try {
          await connect(s);
        } catch (e) {
          if (!cancelled) {
            const c = classifyRemoteError(e);
            if (c.fatalSession) {
              await clearSession();
              await clearOfflineQueue();
              setSession(null);
              setLockedSession(null);
              setTab("pair");
              setStatus((["revoked","not_allowed","offline","timeout","pair_expired","unknown"].includes(c.kind) ? t(`errors.${c.kind}`) : t("errors.unknown")));
              return;
            }
            setStatus(
              e instanceof Error
                ? t("status.offlinePrefix", { msg: e.message })
                : t("status.offlineTapConnect"),
            );
          }
        }
      } finally {
        if (!cancelled) {
          setBootReady(true);
          void SplashScreen.hideAsync().catch(() => {
            /* ignore */
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep-awake while desk stream is live (P4)
  useEffect(() => {
    void setDeskKeepAwake(teleLive && prefs.keepAwakeWhileDesk);
    return () => {
      void setDeskKeepAwake(false);
    };
  }, [teleLive, prefs.keepAwakeWhileDesk]);

  const persistPrefs = async (next: MobileRemotePrefs) => {
    setPrefs(next);
    await savePrefs(next);
  };

  // Refresh schedule/memory when switching to those tabs while online
  useEffect(() => {
    if (!session || !client?.isConnected) return;
    if (tab === "schedule") void refreshSchedulesInternal(client);
    if (tab === "memory") void refreshMemoryInternal(client, memKindFilter);
    if (tab === "tasks" || tab === "home" || tab === "inbox") {
      void syncDesk(client);
    }
    if (tab === "settings") void refreshQueueItems();
    // UX-13: viewing inbox clears unseen badge via markRead + seen ids
    if (tab === "inbox" && inbox.length > 0) {
      const ids = inbox.map((i) => i.id);
      void (async () => {
        try {
          if (client?.isConnected) {
            for (const id of ids) {
              await client.request("inbox.markRead", { id }).catch(() => {});
            }
          }
        } catch {
          /* best-effort */
        }
        await persistPrefs({ ...prefs, seenInboxIds: ids });
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, memKindFilter]);

  // UX-3: Android back pops scanner/stream/tab history before exit
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedTask) {
        setSelectedTask(null);
        setEvents([]);
        setArtifacts([]);
        return true;
      }
      if (tab === "schedule" || tab === "memory") {
        setTab("settings");
        return true;
      }
      if (tab !== "home" && tab !== "pair" && session && unlocked) {
        setTab("home");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selectedTask, tab, session, unlocked]);

  // PM-2: restore per-tab scroll position on switch
  useEffect(() => {
    const y = scrollOffsets.current[tab] ?? 0;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
  }, [tab]);

  // Safety poll (30s) — primary liveness is CX-2 push (was 8s full poll)
  useEffect(() => {
    if (!session || !client?.isConnected || !unlocked) return;
    const id = setInterval(() => {
      void syncDesk(client);
    }, 30_000);
    return () => clearInterval(id);
  }, [session, client, unlocked, syncDesk, client?.isConnected]);

  // PM-4: 1s tick for running-task elapsed timers
  useEffect(() => {
    if (!session || !unlocked) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session, unlocked]);

  // UX-8: while stream card is open, poll events every 2.5s (push also appends)
  useEffect(() => {
    if (!selectedTask || !client?.isConnected) return;
    const id = setInterval(() => {
      void loadEventsIncremental(client, selectedTask);
    }, 2500);
    return () => clearInterval(id);
  }, [selectedTask, client, client?.isConnected, loadEventsIncremental]);

  // CX-3: haptic when a new approval surfaces
  const prevApprovalRef = useRef<string | null>(null);
  useEffect(() => {
    const id = approvalBanner?.taskId ?? null;
    if (id && id !== prevApprovalRef.current && prefs.notifyApprovals) {
      void haptic("warning");
      showToast(t("tasks.approvalNeeded"), "warn");
      void notifyLocal({
        title: t("tasks.approvalNeeded"),
        body: approvalBanner?.title ?? t("tasks.reviewApproval"),
        data: { taskId: id },
      });
    }
    prevApprovalRef.current = id;
  }, [approvalBanner?.taskId, prefs.notifyApprovals, showToast, t]);

  // Resume → re-sync / reconnect (iOS kills sockets in background)
  useEffect(() => {
    if (!session || !unlocked) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void (async () => {
        try {
          const c = client?.isConnected
            ? client
            : await connect(session);
          await syncDesk(c);
        } catch (e) {
          const c = classifyRemoteError(e);
          if (c.fatalSession) {
            await clearSession();
            await clearOfflineQueue();
            setSession(null);
            setClient(null);
            setTab("pair");
            showToast(t("errors.revoked"), "danger");
          } else {
            showToast(
              e instanceof Error ? e.message : t("status.offlineTapConnect"),
              "warn",
            );
          }
        }
      })();
    });
    return () => sub.remove();
  }, [session, unlocked, client, connect, syncDesk, showToast, t]);

  const onPullRefresh = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      const c = client?.isConnected ? client : await connect(session);
      await syncDesk(c);
      if (tab === "schedule") await refreshSchedulesInternal(c);
      if (tab === "memory") await refreshMemoryInternal(c, memKindFilter);
      void haptic("selection");
      showToast(t("home.synced"), "ok");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setRefreshing(false);
    }
  }, [
    session,
    client,
    connect,
    syncDesk,
    tab,
    memKindFilter,
    showToast,
    t,
  ]);

  const runPair = async (raw: string) => {
    const text = raw.trim();
    if (!text) {
      setStatus(t("pair.needQr"));
      setStatusKind("error");
      return;
    }
    pairAbortRef.current = false;
    setBusy(true);
    setPairStep(1);
    setStatus(t("pair.pairing"));
    setStatusKind("info");
    try {
      setPairStep(2);
      const s = await pairWithQr(text, {
        deviceLabel: t("pair.deviceLabel"),
        createWs: createBrowserWs,
      });
      if (pairAbortRef.current) return;
      setPairStep(3);
      await saveSession(s);
      await clearOfflineQueue();
      setSession(s);
      setLockedSession(null);
      client?.close();
      const c = new RemoteGatewayClient(s, createBrowserWs);
      bindClient(c);
      await c.connect();
      if (pairAbortRef.current) return;
      await syncDesk(c);
      setUnlocked(true);
      setTab("home");
      setStatus(t("pair.paired"));
      setStatusKind("info");
      void haptic("success");
      showToast(t("pair.paired"), "ok");
    } catch (e) {
      if (pairAbortRef.current) return;
      const c = classifyRemoteError(e);
      const msg =
        c.kind !== "unknown"
          ? `${(["revoked","not_allowed","offline","timeout","pair_expired","unknown"].includes(c.kind) ? t(`errors.${c.kind}`) : t("errors.unknown"))}: ${c.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setStatus(msg);
      setStatusKind("error");
      setPairStep(0);
      void haptic("error");
      showToast(msg, "danger");
    } finally {
      setBusy(false);
    }
  };

  const unlockWithBiometrics = async () => {
    const s = lockedSession ?? (await loadSession());
    if (!s) {
      setStatus(t("unlock.noSession"));
      return;
    }
    setBusy(true);
    try {
      const unlock = await ensureBiometricUnlock({
        enabled: true,
        allowPassThroughWithoutHardware: biometricPassThrough(),
      });
      if (!unlock.ok) {
        setUnlockError(unlock.reason ?? t("unlock.failed"));
        setStatus(unlock.reason ?? t("unlock.failed"));
        return;
      }
      setUnlockError(null);
      setLockedSession(null);
      setUnlocked(true);
      setSession(s);
      setTab("home");
      setStatus(t("status.reconnecting"));
      await connect(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUnlockError(msg);
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  const refreshTasks = async () => {
    setTasksLoading(true);
    try {
      const c = await ensureClient();
      const list = (await c.request("tasks.list")) as typeof tasks;
      setTasks(Array.isArray(list) ? list : []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setTasksLoading(false);
    }
  };

  const createTask = async () => {
    const composed = composeTaskGoal({
      goal,
      note: taskNote,
      voiceTranscript: voiceNote,
    });
    if (!composed) {
      showToast(t("home.goalRequired"), "warn");
      return;
    }
    setBusy(true);
    try {
      const c = await ensureClient();
      // Gateway always allocates a managed workspace when roots are empty —
      // don't depend on workspace.ensureTemp for mobile create.
      const created = (await c.request("tasks.create", {
        goal: composed,
        mode: "interactive",
        model: deskModel,
        effort: "normal",
        workspaceRoots: [],
        approvalMode,
        skills: [],
        mcpServerIds: [],
        attachments: [],
      })) as { id?: string };
      if (!created?.id) {
        throw new Error(t("home.taskCreateNoId"));
      }
      setGoal("");
      setTaskNote("");
      setVoiceNote("");
      setHomeAdvanced(false);
      // Pull fresh list so Home/Tasks show the new row immediately
      const list = (await c.request("tasks.list")) as typeof tasks;
      setTasks(Array.isArray(list) ? list : []);
      setLastSyncedAt(Date.now());
      void haptic("success");
      showToast(t("home.taskCreated"), "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void haptic("error");
      showToast(msg, "danger");
    } finally {
      setBusy(false);
    }
  };

  const pauseAll = async () => {
    setBusy(true);
    try {
      const c = await ensureClient();
      await c.request("tasks.pauseAll");
      showToast(t("tasks.pausedAll"), "ok");
      void haptic("success");
      await syncDesk(c);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const resumeAll = async () => {
    setBusy(true);
    try {
      const c = await ensureClient();
      await c.request("tasks.resumeAll");
      showToast(t("tasks.resumedAll"), "ok");
      void haptic("success");
      await syncDesk(c);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const cancelTask = async (taskId: string) => {
    setBusy(true);
    try {
      const c = await ensureClient();
      await c.request("tasks.cancel", { taskId });
      showToast(t("tasks.cancelled"), "ok");
      void haptic("warning");
      setSelectedTask(null);
      setEvents([]);
      await syncDesk(c);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const sendFollowUp = async () => {
    const text = followUp.trim();
    if (!text || !selectedTask) return;
    setBusy(true);
    try {
      const c = await ensureClient();
      await c.request("tasks.create", {
        goal: text,
        mode: "interactive",
        model: deskModel,
        effort: "normal",
        workspaceRoots: [],
        approvalMode,
        skills: [],
        mcpServerIds: [],
        attachments: [],
        parentTaskId: selectedTask,
      });
      setFollowUp("");
      void haptic("success");
      showToast(t("tasks.followUpSent"), "ok");
      await syncDesk(c);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const loadArtifacts = async (taskId: string) => {
    try {
      const c = await ensureClient();
      const list = (await c.request("artifacts.list", { taskId })) as Array<{
        id: string;
        name?: string;
        kind?: string;
      }>;
      setArtifacts(Array.isArray(list) ? list : []);
    } catch {
      setArtifacts([]);
    }
  };

  const dismissInboxItem = async (id: string) => {
    try {
      const c = await ensureClient();
      await c.request("inbox.dismiss", { id });
      setInbox((prev) => prev.filter((i) => i.id !== id));
      void haptic("selection");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    }
  };

  const loadEvents = async (taskId: string) => {
    setSelectedTask(taskId);
    setEventAfterSeq(0);
    eventAfterSeqRef.current = 0;
    setBusy(true);
    try {
      const c = await ensureClient();
      // Page through server-capped events.list until a short page (or safety stop).
      const all: Array<{ seq?: number }> = [];
      let after = 0;
      for (let page = 0; page < 20; page++) {
        const batch = (await c.request("events.list", {
          taskId,
          afterSeq: after,
        })) as Array<{ seq?: number }>;
        if (!Array.isArray(batch) || batch.length === 0) break;
        all.push(...batch);
        const maxSeq = batch.reduce(
          (m, e) => Math.max(m, typeof e.seq === "number" ? e.seq : m),
          after,
        );
        after = maxSeq;
        if (batch.length < 500) break;
      }
      setEvents(all);
      setEventAfterSeq(after);
      eventAfterSeqRef.current = after;
      void loadArtifacts(taskId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (
    taskId: string,
    approvalId: string,
    decision: "approve" | "reject",
  ) => {
    const key = `${taskId}:${approvalId}`;
    setPendingApprove((p) => ({ ...p, [key]: true }));
    // PM-3: optimistic resolve + haptic immediately
    void haptic(decision === "approve" ? "success" : "warning");
    setEvents((prev) =>
      prev.map((raw) => {
        const e = raw as {
          kind?: string;
          payload?: { approvalId?: string };
        };
        if (
          e.kind === "approval_required" &&
          e.payload?.approvalId === approvalId
        ) {
          return {
            ...e,
            kind: decision === "approve" ? "approval_granted" : "approval_rejected",
            _optimistic: true,
          };
        }
        return raw;
      }),
    );
    setApprovalBanner(null);
    try {
      const c = await ensureClient();
      await c.request("tasks.approve", { taskId, approvalId, decision });
      await loadEvents(taskId);
      await syncDesk(c);
    } catch (e) {
      void haptic("error");
      showToast(e instanceof Error ? e.message : String(e), "danger");
      await loadEvents(taskId);
    } finally {
      setPendingApprove((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };

  const refreshInbox = async () => {
    setInboxLoading(true);
    try {
      const c = await ensureClient();
      const list = (await c.request("inbox.list")) as Array<{
        id: string;
        title?: string;
        body?: string;
        kind?: string;
        taskId?: string | null;
      }>;
      const items = Array.isArray(list) ? list : [];
      setInbox(items);
      if (prefs.notifyInbox) {
        const { newIds, nextSeen } = diffNewInboxIds(
          prefs.seenInboxIds,
          items.map((i) => i.id),
        );
        if (newIds.length > 0) {
          const first = items.find((i) => i.id === newIds[0]);
          setNotifyBanner(
            first?.title
              ? `Inbox: ${first.title} (+${newIds.length - 1 > 0 ? newIds.length - 1 : 0} more)`.replace(
                  " (+0 more)",
                  "",
                )
              : `${newIds.length} new inbox item(s)`,
          );
          void haptic("warning");
          await persistPrefs({ ...prefs, seenInboxIds: nextSeen });
        } else {
          await persistPrefs({ ...prefs, seenInboxIds: nextSeen });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setInboxLoading(false);
    }
  };

  const refreshDisplays = async () => {
    try {
      const c = await ensureClient();
      const list = (await c.listDisplays()) as DisplayInfo[];
      setDisplays(Array.isArray(list) ? list : []);
    } catch (e) {
      setDisplays([]);
      showToast(e instanceof Error ? e.message : String(e), "warn");
    }
  };

  const loadDeskDiagnostics = async () => {
    try {
      const c = await ensureClient();
      const st = (await c.request("remote.telepresence.status")) as {
        active?: boolean;
        quality?: string;
        displayId?: string | null;
        framesSent?: number;
        lastError?: string | null;
      };
      const tray = (await c.request("tray.status").catch(() => null)) as {
        phase?: string;
      } | null;
      // Gateway returns RemoteDeviceRow: id, label, lastSeenAt, revokedAt
      const devices = (await c
        .request("remote.devices.list")
        .catch(() => [])) as Array<{
        id: string;
        label?: string;
        lastSeenAt?: string | null;
        revokedAt?: string | null;
      }>;
      const active = Array.isArray(devices)
        ? devices.filter((d) => !d.revokedAt)
        : [];
      setPairedDevices(active);
      setDeskDiag(
        [
          `tele active=${st?.active ?? false}`,
          `quality=${st?.quality ?? "—"}`,
          `display=${st?.displayId ?? "default"}`,
          `frames=${st?.framesSent ?? 0}`,
          st?.lastError ? `err=${st.lastError}` : null,
          tray?.phase ? `tray=${tray.phase}` : null,
          `devices=${active.length}`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (e) {
      const c = classifyRemoteError(e);
      setDeskDiag(
        c.fatalSession
          ? (["revoked","not_allowed","offline","timeout","pair_expired","unknown"].includes(c.kind) ? t(`errors.${c.kind}`) : t("errors.unknown"))
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  };

  const refreshSchedules = async () => {
    setBusy(true);
    try {
      const c = await ensureClient();
      await refreshSchedulesInternal(c);
    } catch (e) {
      setSchedError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createSchedule = async () => {
    if (!schedName.trim() || !schedGoal.trim() || !schedCron.trim()) {
      setSchedError(t("schedule.required"));
      return;
    }
    setBusy(true);
    setSchedError(null);
    try {
      const c = await ensureClient();
      // Mobile has no host path picker — use desk temp workspace
      let roots: string[] = [];
      try {
        const temp = (await c.request("workspace.ensureTemp", {
          label: "mobile-schedule",
        })) as string;
        if (typeof temp === "string" && temp.length > 0) roots = [temp];
      } catch {
        roots = [];
      }
      if (roots.length === 0) {
        throw new Error(
          t("schedule.workspaceFail"),
        );
      }
      await c.request("schedule.create", {
        name: schedName.trim(),
        goalTemplate: schedGoal.trim(),
        cron: schedCron.trim(),
        timezone: schedTz.trim() || "UTC",
        approvalMode: "balanced",
        model: "grok-4.5",
        effort: "normal",
        workspaceRoots: roots,
        quietHoursRespect: true,
      });
      setSchedName("");
      setSchedGoal("");
      await refreshSchedulesInternal(c);
      showToast(t("schedule.created"), "ok");
    } catch (e) {
      setSchedError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    setBusy(true);
    setSchedError(null);
    try {
      const c = client;
      if (c?.isConnected) {
        await c.request("schedule.setEnabled", { id, enabled });
        await refreshSchedulesInternal(c);
        showToast(
          enabled ? t("schedule.ruleEnabled") : t("schedule.ruleDisabled"),
          "ok",
        );
      } else {
        // Safe offline subset: queue setEnabled
        if (!session) throw new Error("Not paired");
        const offlineClient =
          c ?? new RemoteGatewayClient(session, createBrowserWs);
        if (!c) bindClient(offlineClient);
        const r = await offlineClient.requestOrQueue("schedule.setEnabled", {
          id,
          enabled,
        });
        if (r.queued) {
          showToast(t("schedule.queued"), "warn");
          void refreshQueueItems();
          // Optimistic local flip
          setSchedules((prev) =>
            prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
          );
        }
      }
    } catch (e) {
      setSchedError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshMemory = async () => {
    setBusy(true);
    try {
      const c = await ensureClient();
      await refreshMemoryInternal(c, memKindFilter);
    } catch (e) {
      setMemError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveMemory = async () => {
    if (!memTitle.trim()) {
      setMemError(t("memory.titleRequired"));
      return;
    }
    setBusy(true);
    setMemError(null);
    const params = {
      id: memEditId ?? undefined,
      kind: memKind,
      title: memTitle.trim(),
      content: memContent,
    };
    try {
      const c = client;
      if (c?.isConnected) {
        await c.request("memory.upsert", params);
        setMemTitle("");
        setMemContent("");
        setMemEditId(null);
        await refreshMemoryInternal(c, memKindFilter);
        showToast(memEditId ? t("memory.updated") : t("memory.saved"), "ok");
      } else {
        if (!session) throw new Error("Not paired");
        const offlineClient =
          c ?? new RemoteGatewayClient(session, createBrowserWs);
        if (!c) bindClient(offlineClient);
        const r = await offlineClient.requestOrQueue("memory.upsert", params);
        if (r.queued) {
          setMemTitle("");
          setMemContent("");
          setMemEditId(null);
          showToast(t("memory.queuedUpsert"), "warn");
          void refreshQueueItems();
        }
      }
    } catch (e) {
      setMemError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteMemory = async (id: string) => {
    setBusy(true);
    setMemError(null);
    try {
      const c = client;
      if (c?.isConnected) {
        await c.request("memory.delete", { id });
        await refreshMemoryInternal(c, memKindFilter);
        showToast(t("memory.deleted"), "ok");
      } else {
        if (!session) throw new Error("Not paired");
        const offlineClient =
          c ?? new RemoteGatewayClient(session, createBrowserWs);
        if (!c) bindClient(offlineClient);
        const r = await offlineClient.requestOrQueue("memory.delete", { id });
        if (r.queued) {
          setMemories((prev) => prev.filter((m) => m.id !== id));
          showToast(t("memory.queuedDelete"), "warn");
          void refreshQueueItems();
        }
      }
    } catch (e) {
      setMemError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEditMemory = (m: MemoryItem) => {
    setMemEditId(m.id);
    setMemTitle(m.title);
    setMemContent(m.content);
    setMemKind(m.kind);
  };

  const refreshQueueItems = useCallback(async () => {
    try {
      const items = await loadOfflineQueue();
      setQueueItems(
        items.map((i) => ({
          id: i.id,
          method: i.method,
          createdAt: i.createdAt,
        })),
      );
    } catch {
      setQueueItems([]);
    }
  }, []);
  refreshQueueItemsRef.current = refreshQueueItems;

  const cancelQueueItem = async (id: string) => {
    const items = await loadOfflineQueue();
    await saveOfflineQueue(items.filter((i) => i.id !== id));
    await refreshQueueItems();
    void haptic("selection");
    showToast(t("queue.itemCancelled"), "ok");
  };

  const rotateKeys = async () => {
    setBusy(true);
    try {
      const c = await ensureClient();
      const next = await c.rekey();
      await saveSession(next);
      c.replaceSession(next);
      await c.connect();
      void haptic("success");
      showToast(t("settings.rekeyOk"), "ok");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const unpair = async () => {
    try {
      await client?.stopTelepresence();
    } catch {
      /* ignore */
    }
    client?.close();
    setClient(null);
    setTeleLive(false);
    setTeleUri(null);
    await clearSession();
    await clearOfflineQueue();
    setSession(null);
    setTab("pair");
    setUnlocked(false);
    setStatus(t("settings.unpaired"));
    setNotifyBanner(null);
    setPairedDevices([]);
    setConnModel({
      state: "offline",
      attempt: 0,
      lastError: null,
      queueError: null,
      label: t("conn.offline"),
    });
  };

  const startDesk = async (displayId?: string | null) => {
    setBusy(true);
    try {
      const c = await ensureClient();
      const did =
        displayId !== undefined ? displayId : selectedDisplayId;
      await c.startTelepresence(teleQuality, did);
      setTeleLive(true);
      if (did) setSelectedDisplayId(did);
      showToast(
        t("desk.live", {
          quality: teleQuality,
          display: did ? t("desk.displayPart", { id: did }) : "",
          keepAwake: prefs.keepAwakeWhileDesk ? t("desk.keepAwakePart") : "",
        }),
        "ok",
      );
      void refreshDisplays();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const switchDisplay = async (displayId: string) => {
    setSelectedDisplayId(displayId);
    await persistPrefs({ ...prefs, preferredDisplayId: displayId });
    if (teleLive) {
      await startDesk(displayId);
    }
  };

  const stopDesk = async () => {
    setBusy(true);
    try {
      const c = await ensureClient();
      await c.stopTelepresence();
      setTeleLive(false);
      setTeleUri(null);
      showToast(t("desk.disconnected"), "neutral");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const changeQuality = async (q: TelepresenceQuality) => {
    setTeleQuality(q);
    if (!teleLive) return;
    setBusy(true);
    try {
      const c = await ensureClient();
      await c.setTeleQuality(q);
      showToast(t("desk.quality", { q }), "ok");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const onDeskLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const next = { w: width, h: height };
    deskLayoutRef.current = next;
    setDeskLayout(next);
  };

  /**
   * Desk surface gestures → real remote.telepresence.input path:
   * - 1 finger short: tap
   * - 1 finger pan: drag
   * - 2+ fingers pan: scroll (dx/dy)
   * Layout size from onLayout (never hard-coded).
   */
  const deskPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => teleLiveRef.current,
        onMoveShouldSetPanResponder: () => teleLiveRef.current,
        onPanResponderGrant: (evt, gesture) => {
          deskGesture.current = {
            startX: evt.nativeEvent.locationX,
            startY: evt.nativeEvent.locationY,
            maxTouches: Math.max(1, gesture.numberActiveTouches),
          };
        },
        onPanResponderMove: (_evt, gesture) => {
          deskGesture.current.maxTouches = Math.max(
            deskGesture.current.maxTouches,
            gesture.numberActiveTouches,
          );
        },
        onPanResponderRelease: (evt, gesture) => {
          if (!teleLiveRef.current) return;
          const { w: viewW, h: viewH } = deskLayoutRef.current;
          if (viewW <= 0 || viewH <= 0) {
            showToast(t("desk.layoutNotReady"), "warn");
            return;
          }
          const startX = deskGesture.current.startX;
          const startY = deskGesture.current.startY;
          const endX = evt.nativeEvent.locationX;
          const endY = evt.nativeEvent.locationY;
          const dist = Math.hypot(gesture.dx, gesture.dy);
          const multi = deskGesture.current.maxTouches >= 2;

          void (async () => {
            try {
              const c = await ensureClientRef.current();
              if (multi) {
                await c.teleInput({
                  kind: "scroll",
                  viewX: startX,
                  viewY: startY,
                  viewW,
                  viewH,
                  dx: gesture.dx,
                  dy: gesture.dy,
                });
                return;
              }
              if (dist < 12) {
                await c.teleInput({
                  kind: "tap",
                  viewX: startX,
                  viewY: startY,
                  viewW,
                  viewH,
                });
                return;
              }
              await c.teleInput({
                kind: "drag",
                viewX: startX,
                viewY: startY,
                viewX2: endX,
                viewY2: endY,
                viewW,
                viewH,
              });
            } catch (e) {
              showToast(e instanceof Error ? e.message : String(e), "danger");
            }
          })();
        },
      }),
    // showToast is stable; teleLiveRef/ensureClientRef avoid stale closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, t],
  );

  const sendSoftKeys = async () => {
    if (!softKeys.trim()) return;
    try {
      const c = await ensureClient();
      await c.teleInput({ kind: "type", text: softKeys });
      setSoftKeys("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    }
  };

  const mainTabs: Tab[] = ["home", "tasks", "desk", "inbox"];
  const moreTabs: Tab[] = ["schedule", "memory", "settings"];
  const showMore = moreTabs.includes(tab);

  const showPip =
    Boolean(session) &&
    teleLive &&
    prefs.pipEnabled &&
    tab !== "desk" &&
    Boolean(teleUri);

  // Keep dark root painted before bootReady so we never flash white (PM-1).
  if (!bootReady) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      {!(tab === "pair" && !session && !lockedSession) ? (
        <View style={styles.topChrome}>
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>GROK DESK</Text>
              <Text style={styles.title} numberOfLines={1}>
                {session && unlocked ? tabTitle : t("app.name")}
              </Text>
            </View>
            {session && unlocked ? (
              <StatusPill state={connModel.state} label={connModel.label} />
            ) : null}
          </View>
          <BusyOverlay show={busy && tab !== "pair"} />
        </View>
      ) : (
        <View style={styles.topChromeMinimal}>
          <BusyOverlay show={busy} />
        </View>
      )}

      {toast && tab !== "pair" ? (
        <ToastBar
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      ) : null}

      {approvalBanner && prefs.notifyApprovals ? (
        <Banner
          message={t("tasks.approvalBanner", { title: approvalBanner.title })}
          tone="warn"
          actionLabel={t("tasks.reviewApproval")}
          onAction={() => {
            setTab("tasks");
            void loadEvents(approvalBanner.taskId);
          }}
          dismissLabel={t("inbox.dismiss")}
          onDismiss={() => setApprovalBanner(null)}
        />
      ) : null}

      {notifyBanner ? (
        <Banner
          message={notifyBanner}
          tone="warn"
          actionLabel={t("inbox.openInbox")}
          onAction={() => {
            setNotifyBanner(null);
            setTab("inbox");
            void refreshInbox();
          }}
          dismissLabel={t("inbox.dismiss")}
          onDismiss={() => setNotifyBanner(null)}
        />
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        // Avoid fighting Desk pan gestures when telepresence is active
        scrollEnabled={!(tab === "desk" && teleLive)}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          scrollOffsets.current[tab] = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={
          session && unlocked ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onPullRefresh()}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }
      >
        {session &&
        unlocked &&
        connModel.state !== "online" &&
        tab !== "pair" ? (
          <Pressable
            style={({ pressed }) => [
              styles.offlineBanner,
              pressed && { opacity: 0.7, backgroundColor: colors.bgHover },
            ]}
            onPress={() => {
              void haptic("selection");
              void connect(session)
                .then((c) => syncDesk(c))
                .then(() => showToast(t("home.synced"), "ok"))
                .catch((e) =>
                  showToast(
                    e instanceof Error ? e.message : String(e),
                    "danger",
                  ),
                );
            }}
          >
            <View style={styles.offlineDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.offlineTitle}>
                {connModel.state === "reconnecting"
                  ? t("conn.reconnecting")
                  : t("conn.offline")}
              </Text>
              <Text style={styles.offlineBody}>
                {t("status.offlineTapConnect")}
              </Text>
            </View>
            <Text style={styles.offlineAction}>{t("home.connect")}</Text>
          </Pressable>
        ) : null}
        {lockedSession && !unlocked && (
          <View style={styles.unlockWrap}>
            <HeroMark>
              <Icon name="lock" size={28} color={colors.accent} />
            </HeroMark>
            <Text style={styles.unlockTitle}>{t("unlock.title")}</Text>
            <Text style={styles.unlockHint}>
              {t("unlock.hint", { label: bioLabel })}
            </Text>
            {unlockError ? (
              <Text style={[styles.hint, { color: colors.danger, marginBottom: space.md }]}>
                {unlockError}
              </Text>
            ) : null}
            <Btn
              variant="primary"
              title={t("unlock.button")}
              onPress={() => void unlockWithBiometrics()}
              style={{ width: "100%", marginBottom: space.md }}
            />
            <Btn
              variant="ghost"
              title={t("unlock.unpairInstead")}
              onPress={() => {
                void (async () => {
                  setLockedSession(null);
                  await clearSession();
                  await clearOfflineQueue();
                  setStatus(t("settings.unpaired"));
                })();
              }}
            />
          </View>
        )}

        {tab === "pair" && !lockedSession && (
          <PairScreen
            busy={busy}
            status={status}
            statusKind={statusKind}
            pairStep={pairStep}
            onPair={(payload) => runPair(payload)}
            onCancelPair={() => {
              pairAbortRef.current = true;
              setBusy(false);
              setPairStep(0);
              setStatus(t("pair.cancelled"));
              setStatusKind("info");
            }}
          />
        )}

        {tab === "home" && session && (
          <>
            <Card glow>
              <View style={styles.homeHeroRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.homeEyebrow}>
                    {connModel.state === "online"
                      ? t("home.synced")
                      : connModel.label}
                  </Text>
                  <Text style={styles.h}>{t("home.title")}</Text>
                  <Text style={styles.hint} numberOfLines={1}>
                    {t("home.device", { label: session.deviceLabel })}
                  </Text>
                  {lastSyncedAt ? (
                    <Text style={styles.hint}>
                      {t("home.lastSync", {
                        time: new Date(lastSyncedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                      {connModel.state === "online" &&
                      Date.now() - lastSyncedAt > 30_000
                        ? ` · ${t("home.stale")}`
                        : ""}
                    </Text>
                  ) : null}
                </View>
                {connModel.state !== "online" ? (
                  <Btn
                    compact
                    variant="primary"
                    title={t("home.connect")}
                    onPress={() =>
                      void connect(session).catch((e) =>
                        showToast(
                          e instanceof Error ? e.message : String(e),
                          "danger",
                        ),
                      )
                    }
                  />
                ) : (
                  <Btn
                    compact
                    variant="accentSoft"
                    title={t("home.syncNow")}
                    onPress={() =>
                      void (client
                        ? syncDesk(client)
                        : connect(session).then((c) => syncDesk(c)))
                    }
                  />
                )}
              </View>
              <StatStrip
                items={[
                  {
                    label: t("tabs.tasks"),
                    value: String(tasks.length),
                  },
                  {
                    label: t("tabs.inbox"),
                    value: String(inbox.length),
                  },
                  {
                    label: t("home.syncNow"),
                    value: lastSyncedAt
                      ? new Date(lastSyncedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—",
                  },
                ]}
              />
              <View style={styles.quickRow}>
                <Btn
                  compact
                  variant="secondary"
                  title={t("tabs.desk")}
                  onPress={() => setTab("desk")}
                  style={styles.quickBtn}
                />
                <Btn
                  compact
                  variant="secondary"
                  title={t("tabs.tasks")}
                  onPress={() => setTab("tasks")}
                  style={styles.quickBtn}
                />
                <Btn
                  compact
                  variant="ghost"
                  title={t("home.pauseAll")}
                  onPress={() => void pauseAll()}
                  style={styles.quickBtn}
                />
              </View>
              <View style={styles.quickRow}>
                <Btn
                  compact
                  variant="secondary"
                  title={t("tasks.resumeAll")}
                  onPress={() => void resumeAll()}
                  style={styles.quickBtn}
                />
              </View>
            </Card>

            <Card>
              <SectionTitle title={t("home.newTask")} />
              <Field
                value={goal}
                onChangeText={setGoal}
                placeholder={t("home.goalPlaceholder")}
              />
              <View style={styles.chipRow}>
                {(
                  [
                    ["cautious", t("tasks.modeCautious")],
                    ["balanced", t("tasks.modeBalanced")],
                    ["fast", t("tasks.modeFast")],
                  ] as const
                ).map(([key, label]) => (
                  <Chip
                    key={key}
                    label={label}
                    selected={approvalMode === key}
                    onPress={() => {
                      void haptic("selection");
                      setApprovalMode(key);
                    }}
                  />
                ))}
              </View>
              <Text style={styles.hint}>
                {t("tasks.modelLabel", { model: deskModel })}
              </Text>
              <Btn
                compact
                variant="ghost"
                title={
                  homeAdvanced
                    ? t("home.hideAdvanced")
                    : t("home.showAdvanced")
                }
                onPress={() => {
                  void haptic("selection");
                  setHomeAdvanced((v) => !v);
                }}
                style={{ alignSelf: "flex-start", marginBottom: space.sm }}
              />
              {homeAdvanced ? (
                <FadeIn>
                  <Field
                    value={voiceNote}
                    onChangeText={setVoiceNote}
                    placeholder={t("home.voicePlaceholder")}
                    multiline
                  />
                  <Field
                    value={taskNote}
                    onChangeText={setTaskNote}
                    placeholder={t("home.notePlaceholder")}
                    multiline
                  />
                </FadeIn>
              ) : null}
              <Btn
                variant="primary"
                title={t("home.createTask")}
                onPress={() => {
                  void haptic("medium");
                  void createTask();
                }}
              />
            </Card>

            <Card flush>
              <View style={styles.cardPadTop}>
                <SectionTitle
                  title={t("home.recentTasks")}
                  action={
                    <Btn
                      compact
                      variant="ghost"
                      title={t("tasks.refresh")}
                      onPress={() => void refreshTasks()}
                    />
                  }
                />
              </View>
              {busy && tasks.length === 0 ? (
                <SkeletonList rows={3} />
              ) : tasks.length === 0 ? (
                <EmptyState
                  glyph="☰"
                  title={t("tasks.empty")}
                  body={t("home.emptyTasksHint")}
                />
              ) : (
                tasks.slice(0, 6).map((task, i) => (
                  <ListRow
                    key={task.id}
                    title={task.title || task.goal || task.id}
                    badge={task.status ?? "—"}
                    last={i === Math.min(tasks.length, 6) - 1}
                    onPress={() => {
                      void haptic("selection");
                      setTab("tasks");
                      void loadEvents(task.id);
                    }}
                  />
                ))
              )}
            </Card>
          </>
        )}

        {tab === "tasks" && (
          <>
            <ScreenHeader
              title={t("tasks.title")}
              subtitle={t("tasks.count", { n: tasks.length })}
              action={
                <Btn
                  compact
                  variant="accentSoft"
                  title={t("tasks.refresh")}
                  onPress={() => void refreshTasks()}
                />
              }
            />
            <Card flush>
              {(busy || tasksLoading) && tasks.length === 0 ? (
                <SkeletonList rows={5} />
              ) : tasks.length === 0 ? (
                <EmptyState
                  glyph="☰"
                  title={
                    connModel.state === "online" && lastSyncedAt != null
                      ? t("tasks.empty")
                      : t("tasks.unreachable")
                  }
                  body={
                    connModel.state === "online" && lastSyncedAt != null
                      ? t("home.emptyTasksHint")
                      : t("tasks.unreachableHint")
                  }
                  action={
                    connModel.state !== "online" || lastSyncedAt == null ? (
                      <Btn
                        title={t("home.connect")}
                        onPress={() =>
                          session &&
                          void connect(session)
                            .then((c) => syncDesk(c))
                            .catch((e) =>
                              showToast(
                                e instanceof Error ? e.message : String(e),
                                "danger",
                              ),
                            )
                        }
                      />
                    ) : undefined
                  }
                />
              ) : (
                <FlatList
                  data={tasks}
                  keyExtractor={(task) => task.id}
                  scrollEnabled={false}
                  initialNumToRender={12}
                  windowSize={7}
                  renderItem={({ item: task, index: i }) => {
                    const st = (task.status ?? "").toLowerCase();
                    const running =
                      st.includes("run") ||
                      st.includes("active") ||
                      st === "approval_required";
                    const tone =
                      running
                        ? st === "approval_required"
                          ? "warn"
                          : "ok"
                        : st.includes("fail") || st.includes("error")
                          ? "danger"
                          : st.includes("pause") || st.includes("wait")
                            ? "warn"
                            : "neutral";
                    const start = taskStartMs(task);
                    const elapsed =
                      running && start != null
                        ? formatElapsed(nowTick - start, t)
                        : null;
                    return (
                      <ListRow
                        title={task.title || task.goal || task.id}
                        subtitle={
                          elapsed
                            ? elapsed
                            : task.goal && task.title
                              ? task.goal
                              : undefined
                        }
                        meta={elapsed && task.goal ? task.goal : undefined}
                        badge={task.status || "—"}
                        badgeTone={
                          tone as "neutral" | "ok" | "warn" | "danger"
                        }
                        last={i === tasks.length - 1 && !selectedTask}
                        onPress={() => void loadEvents(task.id)}
                      />
                    );
                  }}
                />
              )}
            </Card>
            {selectedTask ? (
              <Card>
                <SectionTitle
                  title={t("tasks.stream")}
                  action={
                    <View style={styles.row}>
                      <Btn
                        compact
                        variant="danger"
                        title={t("tasks.stop")}
                        onPress={() => void cancelTask(selectedTask)}
                      />
                      <Btn
                        compact
                        variant="ghost"
                        title="×"
                        onPress={() => {
                          setSelectedTask(null);
                          setEvents([]);
                          setArtifacts([]);
                          setEventAfterSeq(0);
                          eventAfterSeqRef.current = 0;
                        }}
                      />
                    </View>
                  }
                />
                {events.length === 0 ? (
                  <Text style={styles.hint}>{t("tasks.streamEmpty")}</Text>
                ) : (
                  events.map((ev, i) => {
                    const e = ev as {
                      kind?: string;
                      id?: string;
                      payload?: { approvalId?: string; text?: string };
                      _optimistic?: boolean;
                    };
                    const approvalKey = e.payload?.approvalId
                      ? `${selectedTask}:${e.payload.approvalId}`
                      : "";
                    const approving = approvalKey
                      ? pendingApprove[approvalKey]
                      : false;
                    return (
                      <View key={String(e.id ?? i)} style={styles.streamItem}>
                        <View style={styles.streamHead}>
                          <Badge
                            label={e.kind ?? "event"}
                            tone={
                              e.kind === "approval_required"
                                ? "warn"
                                : e.kind?.includes("approval")
                                  ? "ok"
                                  : "neutral"
                            }
                          />
                        </View>
                        {e.payload?.text ? (
                          <Text style={styles.hint} numberOfLines={8}>
                            {e.payload.text}
                          </Text>
                        ) : null}
                        {e.kind === "approval_required" &&
                        e.payload?.approvalId ? (
                          <View style={styles.row}>
                            <Btn
                              variant="primary"
                              title={t("tasks.approve")}
                              disabled={Boolean(approving)}
                              onPress={() =>
                                void approve(
                                  selectedTask,
                                  e.payload!.approvalId!,
                                  "approve",
                                )
                              }
                              style={{ flex: 1 }}
                            />
                            <Btn
                              variant="danger"
                              title={t("tasks.reject")}
                              disabled={Boolean(approving)}
                              onPress={() =>
                                void approve(
                                  selectedTask,
                                  e.payload!.approvalId!,
                                  "reject",
                                )
                              }
                              style={{ flex: 1 }}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
                {artifacts.length > 0 ? (
                  <View style={{ marginTop: space.md }}>
                    <SectionTitle title={t("tasks.artifacts")} />
                    {artifacts.map((a) => (
                      <Text key={a.id} style={styles.hint}>
                        {a.name || a.id}
                        {a.kind ? ` · ${a.kind}` : ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <Field
                  value={followUp}
                  onChangeText={setFollowUp}
                  placeholder={t("tasks.followUpPlaceholder")}
                  multiline
                />
                <Btn
                  variant="secondary"
                  title={t("tasks.sendFollowUp")}
                  onPress={() => void sendFollowUp()}
                />
              </Card>
            ) : null}
          </>
        )}

        {tab === "schedule" && session && (
          <>
            <MoreNav
              items={[
                { key: "schedule", label: t("tabs.schedule") },
                { key: "memory", label: t("tabs.memory") },
                { key: "settings", label: t("tabs.settings") },
              ]}
              active="schedule"
              onChange={(k) => setTab(k as Tab)}
            />
            <ScreenHeader
              title={t("schedule.title")}
              subtitle={t("schedule.hint")}
              action={
                <Btn
                  compact
                  variant="accentSoft"
                  title={t("schedule.refresh")}
                  onPress={() => void refreshSchedules()}
                />
              }
            />
            {schedLoading ? (
              <ActivityIndicator color={colors.accent} style={styles.inlineSpinner} />
            ) : null}
            {schedError ? <Text style={styles.error}>{schedError}</Text> : null}
            <Card flush>
              {!schedLoading && schedules.length === 0 && !schedError ? (
                <EmptyState glyph="◷" title={t("schedule.empty")} />
              ) : schedLoading && schedules.length === 0 ? (
                <SkeletonList rows={3} />
              ) : (
                schedules.map((r, i) => (
                  <ListRow
                    key={r.id}
                    title={r.name}
                    subtitle={r.goalTemplate}
                    meta={`${r.cron ?? "—"} · ${r.timezone ?? ""}`}
                    badge={
                      r.enabled ? t("schedule.enabled") : t("schedule.disabled")
                    }
                    badgeTone={r.enabled ? "ok" : "neutral"}
                    last={i === schedules.length - 1}
                    right={
                      <Btn
                        compact
                        variant={r.enabled ? "ghost" : "primary"}
                        title={
                          r.enabled
                            ? t("schedule.disable")
                            : t("schedule.enable")
                        }
                        onPress={() => void toggleSchedule(r.id, !r.enabled)}
                      />
                    }
                  />
                ))
              )}
            </Card>
            <Card>
              <SectionTitle title={t("schedule.newRule")} />
              <Field
                label={t("schedule.name")}
                value={schedName}
                onChangeText={setSchedName}
                placeholder={t("schedule.name")}
              />
              <Field
                label={t("schedule.goal")}
                value={schedGoal}
                onChangeText={setSchedGoal}
                placeholder={t("schedule.goal")}
                multiline
              />
              <Field
                label={t("schedule.cron")}
                value={schedCron}
                onChangeText={setSchedCron}
                placeholder={t("schedule.cron")}
                autoCapitalize="none"
              />
              <Field
                label={t("schedule.timezone")}
                value={schedTz}
                onChangeText={setSchedTz}
                placeholder={t("schedule.timezone")}
                autoCapitalize="none"
              />
              <Btn
                variant="primary"
                title={t("schedule.create")}
                onPress={() => void createSchedule()}
                disabled={busy}
              />
            </Card>
          </>
        )}

        {tab === "memory" && session && (
          <>
            <MoreNav
              items={[
                { key: "schedule", label: t("tabs.schedule") },
                { key: "memory", label: t("tabs.memory") },
                { key: "settings", label: t("tabs.settings") },
              ]}
              active="memory"
              onChange={(k) => setTab(k as Tab)}
            />
            <ScreenHeader
              title={t("memory.title")}
              subtitle={t("memory.hint")}
              action={
                <Btn
                  compact
                  variant="accentSoft"
                  title={t("memory.refresh")}
                  onPress={() => void refreshMemory()}
                />
              }
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: space.md }}
            >
              <View style={styles.row}>
                {MEMORY_KINDS.map((k) => (
                  <Chip
                    key={k}
                    label={memoryKindLabel(k, t)}
                    selected={memKindFilter === k}
                    onPress={() => setMemKindFilter(k)}
                  />
                ))}
              </View>
            </ScrollView>
            {memLoading ? (
              <ActivityIndicator color={colors.accent} style={styles.inlineSpinner} />
            ) : null}
            {memError ? <Text style={styles.error}>{memError}</Text> : null}
            <Card flush>
              {!memLoading && memories.length === 0 && !memError ? (
                <EmptyState glyph="◈" title={t("memory.empty")} />
              ) : memLoading && memories.length === 0 ? (
                <SkeletonList rows={3} />
              ) : (
                memories.map((m, i) => (
                  <ListRow
                    key={m.id}
                    title={m.title}
                    subtitle={m.content}
                    badge={memoryKindLabel(m.kind, t)}
                    badgeTone="accent"
                    last={i === memories.length - 1}
                    right={
                      <View style={styles.rowTight}>
                        <Btn
                          compact
                          variant="ghost"
                          title={t("memory.edit")}
                          onPress={() => startEditMemory(m)}
                        />
                        <Btn
                          compact
                          variant="danger"
                          title={t("memory.delete")}
                          onPress={() => void deleteMemory(m.id)}
                        />
                      </View>
                    }
                  />
                ))
              )}
            </Card>
            <Card>
              <SectionTitle
                title={memEditId ? t("memory.editItem") : t("memory.newItem")}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: space.md }}
              >
                <View style={styles.row}>
                  {(
                    [
                      "profile",
                      "project",
                      "brand",
                      "preference",
                      "episodic",
                      "now",
                      "standing",
                    ] as MemoryKind[]
                  ).map((k) => (
                    <Chip
                      key={k}
                      label={memoryKindLabel(k, t)}
                      selected={memKind === k}
                      onPress={() => setMemKind(k)}
                    />
                  ))}
                </View>
              </ScrollView>
              <Field
                label={t("memory.titleField")}
                value={memTitle}
                onChangeText={setMemTitle}
                placeholder={t("memory.titleField")}
              />
              <Field
                label={t("memory.contentField")}
                style={{ minHeight: 110 }}
                value={memContent}
                onChangeText={setMemContent}
                placeholder={t("memory.contentField")}
                multiline
              />
              <View style={styles.row}>
                <Btn
                  variant="primary"
                  title={memEditId ? t("memory.update") : t("memory.save")}
                  onPress={() => void saveMemory()}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                {memEditId ? (
                  <Btn
                    variant="ghost"
                    title={t("memory.cancelEdit")}
                    onPress={() => {
                      setMemEditId(null);
                      setMemTitle("");
                      setMemContent("");
                    }}
                  />
                ) : null}
              </View>
            </Card>
          </>
        )}

        {tab === "desk" && session && (
          <>
            <ScreenHeader
              title={t("desk.title")}
              subtitle={
                teleLive
                  ? t("desk.live", {
                      quality: t(`quality.${teleQuality}`),
                      display: selectedDisplayId
                        ? t("desk.displayPart", { id: selectedDisplayId })
                        : "",
                      keepAwake: prefs.keepAwakeWhileDesk
                        ? t("desk.keepAwakePart")
                        : "",
                    })
                  : t("desk.hintShort")
              }
              action={
                !teleLive ? (
                  <Btn
                    compact
                    variant="primary"
                    title={t("desk.connectStream")}
                    onPress={() => {
                      void haptic("medium");
                      void startDesk();
                    }}
                  />
                ) : (
                  <Btn
                    compact
                    variant="danger"
                    title={t("desk.disconnect")}
                    onPress={() => {
                      void haptic("warning");
                      void stopDesk();
                    }}
                  />
                )
              }
            />
            <View
              style={[styles.deskView, teleLive && styles.deskViewLive]}
              onLayout={onDeskLayout}
              {...deskPan.panHandlers}
            >
              {teleUri ? (
                <Image
                  source={{ uri: teleUri }}
                  style={styles.deskImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.deskEmpty}>
                  <Text style={styles.deskEmptyGlyph}>▣</Text>
                  <Text style={styles.deskEmptyTitle}>
                    {t("desk.noFrame")}
                  </Text>
                  <Text style={styles.deskEmptyBody}>{t("desk.hintShort")}</Text>
                  {!teleLive ? (
                    <Btn
                      variant="primary"
                      title={t("desk.connectStream")}
                      onPress={() => {
                        void haptic("medium");
                        void startDesk();
                      }}
                    />
                  ) : null}
                </View>
              )}
              {teleLive ? (
                <View style={styles.deskLiveBadge}>
                  <Animated.View style={[styles.liveDot, { opacity: livePulse }]} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.gestureHint}>
              {t("desk.gestures", {
                w: Math.round(deskLayout.w),
                h: Math.round(deskLayout.h),
              })}
            </Text>
            <Card>
              <GroupLabel>{t("desk.qualityLabel")}</GroupLabel>
              <Segmented
                options={(
                  ["smooth", "auto", "crisp"] as TelepresenceQuality[]
                ).map((q) => ({
                  key: q,
                  label: t(`quality.${q}`),
                }))}
                value={teleQuality}
                onChange={(k) => void changeQuality(k as TelepresenceQuality)}
              />
              <View style={{ height: space.md }} />
              <GroupLabel>{t("desk.displayLabel")}</GroupLabel>
              {displays.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.row}>
                    {displays.map((d) => (
                      <Chip
                        key={d.id}
                        label={`${d.label || d.id}${d.isPrimary ? ` ${t("desk.primary")}` : ""}`}
                        selected={selectedDisplayId === d.id}
                        onPress={() => void switchDisplay(d.id)}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <Text style={styles.hint}>{t("desk.noDisplays")}</Text>
              )}
              <Btn
                compact
                variant="ghost"
                title={t("desk.refreshDisplays")}
                onPress={() => void refreshDisplays()}
                style={{ alignSelf: "flex-start", marginTop: space.sm }}
              />
            </Card>
            <Card>
              <SectionTitle title={t("desk.controls")} />
              <View style={styles.row}>
                <Btn
                  compact
                  variant="secondary"
                  title={t("desk.scrollUp")}
                  style={{ flex: 1 }}
                  onPress={() =>
                    void (async () => {
                      try {
                        const c = await ensureClient();
                        await c.teleInput({
                          kind: "scroll",
                          nx: 0.5,
                          ny: 0.5,
                          dx: 0,
                          dy: -80,
                        });
                      } catch (e) {
                        showToast(
                          e instanceof Error ? e.message : String(e),
                          "danger",
                        );
                      }
                    })()
                  }
                />
                <Btn
                  compact
                  variant="secondary"
                  title={t("desk.scrollDown")}
                  style={{ flex: 1 }}
                  onPress={() =>
                    void (async () => {
                      try {
                        const c = await ensureClient();
                        await c.teleInput({
                          kind: "scroll",
                          nx: 0.5,
                          ny: 0.5,
                          dx: 0,
                          dy: 80,
                        });
                      } catch (e) {
                        showToast(
                          e instanceof Error ? e.message : String(e),
                          "danger",
                        );
                      }
                    })()
                  }
                />
              </View>
              <Field
                value={softKeys}
                onChangeText={setSoftKeys}
                placeholder={t("desk.typePlaceholder")}
              />
              <Btn
                variant="primary"
                title={t("desk.sendKeys")}
                onPress={() => void sendSoftKeys()}
              />
            </Card>
          </>
        )}

        {tab === "inbox" && (
          <>
            <ScreenHeader
              title={t("inbox.title")}
              subtitle={
                inbox.length
                  ? t("inbox.subtitle", {
                      n: inbox.length,
                      u: inbox.filter((i) => !prefs.seenInboxIds.includes(i.id))
                        .length,
                    })
                  : t("inbox.empty")
              }
              action={
                <Btn
                  compact
                  variant="accentSoft"
                  title={t("inbox.refresh")}
                  onPress={() => void refreshInbox()}
                />
              }
            />
            <Card flush>
              {busy && inbox.length === 0 ? (
                <SkeletonList rows={4} />
              ) : inbox.length === 0 ? (
                <EmptyState glyph="◉" title={t("inbox.empty")} />
              ) : (
                inbox.map((item, i) => {
                  const unseen = !prefs.seenInboxIds.includes(item.id);
                  return (
                    <ListRow
                      key={item.id}
                      title={item.title || item.id}
                      subtitle={item.body}
                      badge={unseen ? t("inbox.new") : item.kind}
                      badgeTone={unseen ? "warn" : "accent"}
                      last={i === inbox.length - 1}
                      right={
                        <Btn
                          compact
                          variant="ghost"
                          title={t("inbox.dismiss")}
                          onPress={() => void dismissInboxItem(item.id)}
                        />
                      }
                      onPress={
                        item.taskId
                          ? () => {
                              setTab("tasks");
                              void loadEvents(item.taskId!);
                            }
                          : undefined
                      }
                    />
                  );
                })
              )}
            </Card>
          </>
        )}

        {tab === "settings" && session && (
          <>
            <MoreNav
              items={[
                { key: "schedule", label: t("tabs.schedule") },
                { key: "memory", label: t("tabs.memory") },
                { key: "settings", label: t("tabs.settings") },
              ]}
              active="settings"
              onChange={(k) => setTab(k as Tab)}
            />
            <ScreenHeader
              title={t("settings.title")}
              subtitle={t("settings.hint")}
            />

            <GroupLabel>{t("settings.defaultQuality")}</GroupLabel>
            <Card>
              <Segmented
                options={(
                  ["smooth", "auto", "crisp"] as TelepresenceQuality[]
                ).map((q) => ({
                  key: q,
                  label: t(`quality.${q}`),
                }))}
                value={prefs.defaultQuality}
                onChange={(k) => {
                  const q = k as TelepresenceQuality;
                  void persistPrefs({ ...prefs, defaultQuality: q });
                  setTeleQuality(q);
                }}
              />
            </Card>

            <GroupLabel>{t("settings.deskBehavior")}</GroupLabel>
            <Card flush>
              <ToggleRow
                title={t("settings.pipLabel")}
                subtitle={t("settings.pipHint")}
                value={prefs.pipEnabled}
                onChange={(v) => {
                  void haptic("selection");
                  void persistPrefs({ ...prefs, pipEnabled: v });
                }}
              />
              <ToggleRow
                title={t("settings.keepAwakeLabel")}
                subtitle={t("settings.keepAwakeHint")}
                value={prefs.keepAwakeWhileDesk}
                onChange={(v) => {
                  void haptic("selection");
                  void persistPrefs({ ...prefs, keepAwakeWhileDesk: v });
                }}
                last
              />
            </Card>

            <GroupLabel>{t("settings.notifications")}</GroupLabel>
            <Card flush>
              <ToggleRow
                title={t("settings.inboxAlertsLabel")}
                value={prefs.notifyInbox}
                onChange={(v) => {
                  void haptic("selection");
                  void persistPrefs({ ...prefs, notifyInbox: v });
                }}
              />
              <ToggleRow
                title={t("settings.approvalAlertsLabel")}
                value={prefs.notifyApprovals}
                onChange={(v) => {
                  void haptic("selection");
                  void persistPrefs({ ...prefs, notifyApprovals: v });
                }}
                last
              />
            </Card>

            <GroupLabel>{t("queue.title")}</GroupLabel>
            <Card>
              <Text style={styles.hint}>
                {queueItems.length
                  ? t("queue.pending", { n: queueItems.length })
                  : t("queue.empty")}
              </Text>
              {queueItems.map((item) => (
                <View key={item.id} style={styles.row}>
                  <Text style={[styles.hint, { flex: 1 }]} numberOfLines={2}>
                    {item.method === "memory.upsert"
                      ? t("queue.methodMemoryUpsert")
                      : item.method === "memory.delete"
                        ? t("queue.methodMemoryDelete")
                        : item.method === "schedule.setEnabled"
                          ? t("queue.methodSchedule")
                          : item.method}
                  </Text>
                  <Btn
                    compact
                    variant="ghost"
                    title={t("queue.cancel")}
                    onPress={() => void cancelQueueItem(item.id)}
                  />
                </View>
              ))}
              <Btn
                compact
                variant="secondary"
                title={t("queue.refresh")}
                onPress={() => void refreshQueueItems()}
                style={{ marginTop: space.sm }}
              />
            </Card>

            <GroupLabel>{t("settings.trust")}</GroupLabel>
            <Card flush>
              <ToggleRow
                title={t("settings.biometricLabel")}
                subtitle={bioLabel}
                value={prefs.biometricLock}
                onChange={(v) => {
                  void haptic("selection");
                  void (async () => {
                    // UX-6: refuse lock enable without enrolled biometrics
                    if (v) {
                      const st = await getBiometricStatus();
                      if (!st.enrolled && !biometricPassThrough()) {
                        showToast(t("unlock.noHardware"), "warn");
                        return;
                      }
                    }
                    await persistPrefs({ ...prefs, biometricLock: v });
                  })();
                }}
                last
              />
            </Card>

            <GroupLabel>{t("settings.language")}</GroupLabel>
            <Card>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.row}>
                  <Chip
                    label={t("settings.languageSystem")}
                    selected={preference === "system"}
                    onPress={() => setLocale("system" as LocalePreference)}
                  />
                  {locales.map((meta) => (
                    <Chip
                      key={meta.code}
                      label={meta.nativeName}
                      selected={preference === meta.code}
                      onPress={() => setLocale(meta.code)}
                    />
                  ))}
                </View>
              </ScrollView>
            </Card>

            <GroupLabel>{t("settings.machineDevice")}</GroupLabel>
            <Card flush>
              <ListRow
                title={t("settings.deviceShort")}
                subtitle={session.deviceLabel}
                meta={session.deviceId.slice(0, 12) + "…"}
              />
              <ListRow
                title={t("settings.machineShort")}
                subtitle={session.machineId.slice(0, 16) + "…"}
              />
              <ListRow
                title={t("settings.relayShort")}
                subtitle={session.relay}
                last
              />
            </Card>

            <Card>
              <SectionTitle
                title={t("settings.diagnostics")}
                action={
                  <Btn
                    compact
                    variant="ghost"
                    title={t("settings.refreshDiag")}
                    onPress={() => void loadDeskDiagnostics()}
                  />
                }
              />
              {deskDiag ? (
                <Text style={styles.mono}>{deskDiag}</Text>
              ) : (
                <Text style={styles.hint}>{t("settings.diagIdle")}</Text>
              )}
              {pairedDevices.length > 0 ? (
                <View style={{ marginTop: space.md }}>
                  <Text style={styles.itemTitle}>
                    {t("settings.pairedDevices")}
                  </Text>
                  {pairedDevices.map((d) => (
                    <Text key={d.id} style={styles.hint}>
                      {d.label || d.id}
                      {d.id === session.deviceId ? t("settings.thisPhone") : ""}
                      {d.lastSeenAt
                        ? t("settings.seen", { at: d.lastSeenAt })
                        : ""}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Card>

            <Btn
              variant="secondary"
              title={t("settings.rekey")}
              onPress={() => void rotateKeys()}
              style={{ marginBottom: space.md }}
            />
            <Btn
              variant="danger"
              title={t("settings.unpair")}
              onPress={() => {
                void haptic("warning");
                void unpair();
              }}
            />
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {showPip ? (
        <View
          style={[
            styles.pip,
            session && unlocked ? { bottom: pipBottom } : null,
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.pipHead}>
            <Text style={styles.pipLabel}>{t("pip.label")}</Text>
            <Animated.View style={[styles.liveDot, { opacity: livePulse }]} />
          </View>
          <Image
            source={{ uri: teleUri! }}
            style={styles.pipImage}
            resizeMode="contain"
          />
          <View style={styles.pipActions}>
            <Btn
              compact
              variant="primary"
              title={t("pip.openDesk")}
              onPress={() => setTab("desk")}
              style={{ flex: 1 }}
            />
            <Btn
              compact
              variant="ghost"
              title={t("pip.stop")}
              onPress={() => void stopDesk()}
            />
          </View>
        </View>
      ) : null}

      {session && unlocked ? (
        <View
          style={[
            styles.tabBar,
            { paddingBottom: tabBarPadBottom, minHeight: tabBarHeight },
          ]}
        >
          {(
            [
              { key: "home" as Tab, label: t("tabs.home"), icon: "home" as const },
              { key: "tasks" as Tab, label: t("tabs.tasks"), icon: "tasks" as const },
              { key: "desk" as Tab, label: t("tabs.desk"), icon: "desk" as const },
              { key: "inbox" as Tab, label: t("tabs.inbox"), icon: "inbox" as const },
              {
                key: "settings" as Tab,
                label: t("tabs.settings"),
                icon: "settings" as const,
              },
            ] as const
          ).map((item) => {
            const active =
              tab === item.key ||
              (item.key === "settings" &&
                (tab === "schedule" || tab === "memory"));
            const unseenInbox =
              item.key === "inbox"
                ? inbox.filter((i) => !prefs.seenInboxIds.includes(i.id)).length
                : 0;
            const inboxCount = unseenInbox;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  if (!active) void haptic("selection");
                  setTab(item.key);
                }}
                android_ripple={{ color: colors.bgHover }}
                style={({ pressed }) => [
                  styles.tabItem,
                  active && styles.tabItemActive,
                  pressed && { opacity: 0.7, backgroundColor: colors.bgHover },
                ]}
              >
                <View>
                  <Icon
                    name={item.icon}
                    size={20}
                    color={active ? colors.accent : colors.textMuted}
                  />
                  {inboxCount > 0 ? (
                    <View style={styles.tabBadge}>
                      <Text style={styles.tabBadgeText}>
                        {inboxCount > 9 ? "9+" : String(inboxCount)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.tabLabel, active && styles.tabLabelActive]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topChrome: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topChromeMinimal: {
    minHeight: 8,
    paddingHorizontal: space.lg,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
  },
  kicker: {
    ...typo.micro,
    color: colors.accent,
    fontWeight: "700",
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  title: {
    ...typo.title,
    color: colors.text,
  },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: 120,
  },
  h: {
    ...typo.section,
    color: colors.text,
    marginBottom: space.sm,
  },
  homeHeroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    marginBottom: space.md,
  },
  homeEyebrow: {
    ...typo.micro,
    color: colors.online,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  quickRow: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.sm,
  },
  quickBtn: {
    flex: 1,
  },
  cardPadTop: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  unlockWrap: {
    alignItems: "center",
    paddingTop: space.xxxl ?? 36,
    paddingHorizontal: space.lg,
  },
  unlockMark: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  unlockGlyph: { color: colors.accent, ...typo.glyphLg },
  unlockTitle: {
    ...typo.hero,
    color: colors.text,
    textAlign: "center",
    marginBottom: space.sm,
  },
  unlockHint: {
    ...typo.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: space.xl,
    maxWidth: 300,
  },
  hint: {
    ...typo.caption,
    color: colors.textMuted,
    marginBottom: space.md,
    lineHeight: 18,
  },
  mono: {
    ...typo.caption,
    color: colors.textSecondary,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    lineHeight: 18,
  },
  error: {
    ...typo.caption,
    color: colors.danger,
    marginBottom: space.sm,
  },
  row: {
    flexDirection: "row",
    gap: space.sm,
    marginVertical: space.sm,
    flexWrap: "wrap",
    alignItems: "center",
  },
  rowTight: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  streamItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
    marginTop: space.sm,
  },
  streamHead: { marginBottom: space.sm },
  itemTitle: {
    ...typo.body,
    color: colors.text,
    fontWeight: "600",
    marginBottom: 4,
  },
  deskView: {
    height: 280,
    backgroundColor: colors.deskBlack,
    borderRadius: radius.lg,
    marginBottom: space.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  deskViewLive: {
    borderColor: "rgba(93,206,138,0.35)",
  },
  deskImage: { width: "100%", height: "100%" },
  deskEmpty: {
    alignItems: "center",
    padding: space.xl,
    gap: space.sm,
  },
  deskEmptyGlyph: {
    fontSize: 32,
    color: colors.textMuted,
    marginBottom: space.sm,
  },
  deskEmptyTitle: {
    ...typo.section,
    color: colors.textSecondary,
    textAlign: "center",
  },
  deskEmptyBody: {
    ...typo.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: space.md,
    lineHeight: 18,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warn,
    marginTop: 6,
    marginRight: space.sm,
  },
  deskLiveBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.online,
  },
  elapsedText: {
    ...typo.caption,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  liveText: {
    ...typo.micro,
    color: colors.online,
    fontWeight: "800",
    letterSpacing: 1,
  },
  gestureHint: {
    ...typo.micro,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: space.md,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warnBorder,
  },
  offlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.warn,
  },
  offlineTitle: {
    ...typo.label,
    color: colors.text,
  },
  offlineBody: {
    ...typo.micro,
    color: colors.textMuted,
    marginTop: 2,
  },
  offlineAction: {
    ...typo.caption,
    color: colors.accent,
    fontWeight: "700",
  },
  banner: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  bannerText: {
    ...typo.label,
    color: colors.text,
    marginBottom: space.sm,
    lineHeight: 18,
  },
  pip: {
    position: "absolute",
    right: space.lg,
    bottom: space.lg,
    width: 168,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: space.sm,
    zIndex: 20,
    ...shadow.pip,
  },
  pipHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  pipLabel: {
    ...typo.micro,
    color: colors.accent,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  pipImage: {
    width: "100%",
    height: 96,
    backgroundColor: colors.deskBlack,
    borderRadius: radius.sm,
  },
  pipActions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.tabBar,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    paddingHorizontal: space.xs,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  tabItemActive: {
    backgroundColor: colors.accentSoft,
  },
  tabGlyph: {
    ...typo.glyphSm,
    color: colors.textMuted,
    marginBottom: space.xs,
    textAlign: "center",
  },
  tabGlyphActive: {
    color: colors.accent,
  },
  tabLabel: {
    ...typo.micro,
    color: colors.textMuted,
    textTransform: "capitalize",
  },
  tabLabelActive: {
    color: colors.accent,
    fontWeight: "700",
  },
  tabBadge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.accentText,
    fontVariant: ["tabular-nums"],
  },
  inlineSpinner: { marginVertical: space.lg },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginBottom: space.sm,
  },
});
