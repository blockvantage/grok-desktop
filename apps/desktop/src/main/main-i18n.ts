/**
 * Minimal main-process catalog (tray + native dialogs).
 * Renderer pushes the resolved UI locale over IPC; no shared renderer imports.
 */

export type MainLocale = "en" | "es" | "fr" | "de" | "pt" | "ja" | "zh";

const LOCALES: readonly MainLocale[] = [
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "ja",
  "zh",
];

const M = {
  trayOpen: {
    en: "Open Grok Desk",
    es: "Abrir Grok Desk",
    fr: "Ouvrir Grok Desk",
    de: "Grok Desk öffnen",
    pt: "Abrir Grok Desk",
    ja: "Grok Desk を開く",
    zh: "打开 Grok Desk",
  },
  trayRemote: {
    en: "Remote access…",
    es: "Acceso remoto…",
    fr: "Accès distant…",
    de: "Fernzugriff…",
    pt: "Acesso remoto…",
    ja: "リモートアクセス…",
    zh: "远程访问…",
  },
  trayPauseAll: {
    en: "Pause all tasks",
    es: "Pausar todas las tareas",
    fr: "Mettre toutes les tâches en pause",
    de: "Alle Aufgaben anhalten",
    pt: "Pausar todas as tarefas",
    ja: "すべてのタスクを一時停止",
    zh: "暂停所有任务",
  },
  trayResumeAll: {
    en: "Resume all tasks",
    es: "Reanudar todas las tareas",
    fr: "Reprendre toutes les tâches",
    de: "Alle Aufgaben fortsetzen",
    pt: "Retomar todas as tarefas",
    ja: "すべてのタスクを再開",
    zh: "恢复所有任务",
  },
  trayStopRemote: {
    en: "Stop remote control",
    es: "Detener control remoto",
    fr: "Arrêter le contrôle à distance",
    de: "Fernsteuerung beenden",
    pt: "Parar controle remoto",
    ja: "リモート操作を停止",
    zh: "停止远程控制",
  },
  trayQuit: {
    en: "Quit",
    es: "Salir",
    fr: "Quitter",
    de: "Beenden",
    pt: "Sair",
    ja: "終了",
    zh: "退出",
  },
  engineReady: {
    en: "engine ready",
    es: "motor listo",
    fr: "moteur prêt",
    de: "Engine bereit",
    pt: "mecanismo pronto",
    ja: "エンジン準備完了",
    zh: "引擎就绪",
  },
  engineStarting: {
    en: "engine starting",
    es: "motor iniciando",
    fr: "moteur en démarrage",
    de: "Engine startet",
    pt: "mecanismo iniciando",
    ja: "エンジン起動中",
    zh: "引擎启动中",
  },
  engineReconnecting: {
    en: "engine reconnecting",
    es: "motor reconectando",
    fr: "moteur en reconnexion",
    de: "Engine stellt Verbindung wieder her",
    pt: "mecanismo reconectando",
    ja: "エンジン再接続中",
    zh: "引擎重新连接中",
  },
  engineStopped: {
    en: "engine stopped",
    es: "motor detenido",
    fr: "moteur arrêté",
    de: "Engine gestoppt",
    pt: "mecanismo parado",
    ja: "エンジン停止",
    zh: "引擎已停止",
  },
  engineIdle: {
    en: "engine idle",
    es: "motor inactivo",
    fr: "moteur inactif",
    de: "Engine im Leerlauf",
    pt: "mecanismo ocioso",
    ja: "エンジン待機中",
    zh: "引擎空闲",
  },
  dialogStartFailed: {
    en: "Grok Desk failed to start",
    es: "Grok Desk no pudo iniciarse",
    fr: "Échec du démarrage de Grok Desk",
    de: "Grok Desk konnte nicht gestartet werden",
    pt: "Falha ao iniciar o Grok Desk",
    ja: "Grok Desk の起動に失敗しました",
    zh: "Grok Desk 启动失败",
  },
  notifyAppName: {
    en: "Grok Desk",
    es: "Grok Desk",
    fr: "Grok Desk",
    de: "Grok Desk",
    pt: "Grok Desk",
    ja: "Grok Desk",
    zh: "Grok Desk",
  },
  notifyBrowserApproval: {
    en: "Browser action needs your approval",
    es: "Una acción del navegador necesita tu visto bueno",
    fr: "Une action du navigateur attend votre accord",
    de: "Eine Browser-Aktion braucht deine Freigabe",
    pt: "Uma ação do navegador precisa da sua aprovação",
    ja: "ブラウザ操作の許可が必要です",
    zh: "浏览器操作需要你批准",
  },
  notifyTaskWaiting: {
    en: "A task is waiting for your approval",
    es: "Una tarea espera tu aprobación",
    fr: "Une tâche attend votre approbation",
    de: "Eine Aufgabe wartet auf deine Freigabe",
    pt: "Uma tarefa espera a sua aprovação",
    ja: "タスクが承認待ちです",
    zh: "有一项任务在等你批准",
  },
} as const satisfies Record<string, Record<MainLocale, string>>;

export type MainI18nKey = keyof typeof M;

let current: MainLocale = "en";

/** Listeners notified when the main-process locale changes (e.g. tray rebuild). */
const localeListeners = new Set<() => void>();

export function setMainLocale(l: string): void {
  if (!(LOCALES as readonly string[]).includes(l)) return;
  if (current === l) return;
  current = l as MainLocale;
  for (const cb of localeListeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

export function getMainLocale(): MainLocale {
  return current;
}

export function onMainLocaleChange(cb: () => void): () => void {
  localeListeners.add(cb);
  return () => {
    localeListeners.delete(cb);
  };
}

export function mt(key: MainI18nKey): string {
  return M[key]?.[current] ?? M[key]?.en ?? String(key);
}
