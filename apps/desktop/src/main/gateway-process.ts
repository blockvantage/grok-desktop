import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { mainLog } from "./log";
import { redactSecrets } from "./redact";
import {
  restartBackoffMs,
  shouldRestartGateway,
  type GatewayLifecycleStatus,
  MAX_GATEWAY_RESTARTS,
} from "./redact";
import { GROKDESK_PRODUCT_KEY_ENFORCEMENT } from "@grokdesk/shared";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

/** Drop gateway→main JSON lines larger than this before parse (DoS guard). */
export const GATEWAY_STDOUT_MAX_LINE_BYTES = 2 * 1024 * 1024; // 2 MiB
/** Ring of recent stderr kept for exit diagnostics only. */
export const GATEWAY_STDERR_RING_CHARS = 8_192;

/** Append text to a bounded diagnostic ring (keeps the newest chars). */
export function appendStderrRing(
  current: string,
  chunk: string,
  maxChars = GATEWAY_STDERR_RING_CHARS,
): string {
  if (!chunk) return current;
  const next = current + chunk;
  if (next.length <= maxChars) return next;
  return next.slice(next.length - maxChars);
}

/**
 * Resolve packaged or monorepo skills root for GROKDESK_BUNDLED_SKILLS.
 * electron-builder packs skills/ into process.resourcesPath/skills.
 */
export function resolveBundledSkillsPath(): string | undefined {
  if (process.env.GROKDESK_BUNDLED_SKILLS?.trim()) {
    return process.env.GROKDESK_BUNDLED_SKILLS.trim();
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    if (app?.isPackaged) {
      const p = path.join(process.resourcesPath, "skills");
      if (fs.existsSync(p)) return p;
    }
  } catch {
    // not in electron main
  }
  const monorepo = path.resolve(__dirname, "../../../../skills");
  if (fs.existsSync(monorepo)) return monorepo;
  const cwdSkills = path.join(process.cwd(), "skills");
  if (fs.existsSync(cwdSkills)) return cwdSkills;
  return undefined;
}

declare const __GROKDESK_LICENSE_PUBLIC_KEY__: string | undefined;
declare const __GROKDESK_DEV_UNLOCK__: boolean | string | undefined;

function resolveLicensePublicKeyForGateway(): string | undefined {
  const fromEnv = process.env.GROKDESK_LICENSE_PUBLIC_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const baked =
      typeof __GROKDESK_LICENSE_PUBLIC_KEY__ === "string"
        ? __GROKDESK_LICENSE_PUBLIC_KEY__.trim()
        : "";
    return baked || undefined;
  } catch {
    return undefined;
  }
}

/** Compile-time install-build unlock (see electron.vite.config.ts). */
function isBakedDevUnlock(): boolean {
  try {
    const v = __GROKDESK_DEV_UNLOCK__;
    return v === true || v === "true" || v === "1";
  } catch {
    return false;
  }
}

function isPackagedElectron(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    return Boolean(app?.isPackaged);
  } catch {
    return false;
  }
}

/**
 * Packaged builds rebuild better-sqlite3 against Electron's Node ABI.
 * Run the gateway with Electron-as-Node (process.execPath + ELECTRON_RUN_AS_NODE).
 *
 * In electron-vite dev, process.execPath is already Electron — use the same
 * path so better-sqlite3 (Electron ABI) loads. Host `node` only when the main
 * process is truly Node (tests) or GROKDESK_NODE_PATH is set.
 */
export function resolveNodeBinary(): { command: string; electronAsNode: boolean } {
  if (process.env.GROKDESK_NODE_PATH?.trim()) {
    return {
      command: process.env.GROKDESK_NODE_PATH.trim(),
      electronAsNode: false,
    };
  }
  if (isPackagedElectron()) {
    return { command: process.execPath, electronAsNode: true };
  }
  // Dev under Electron (electron-vite): match native module ABI.
  const exec = process.execPath;
  if (/electron/i.test(exec) || /electron/i.test(path.basename(exec))) {
    return { command: exec, electronAsNode: true };
  }
  return { command: "node", electronAsNode: false };
}

/**
 * Absolute Node (or Electron-as-Node) for desk-browser / desk-desktop MCP.
 * GUI-launched Mac apps often have a PATH without `node`, so bare `command =
 * "node"` fails and Grok reports "desk-browser failed to connect".
 */
export function resolveMcpNodeBinary(): {
  command: string;
  electronAsNode: boolean;
} {
  if (process.env.GROKDESK_NODE_PATH?.trim()) {
    return {
      command: process.env.GROKDESK_NODE_PATH.trim(),
      electronAsNode: false,
    };
  }
  if (isPackagedElectron()) {
    return { command: process.execPath, electronAsNode: true };
  }
  // Prefer an absolute path when possible so Grok MCP spawn doesn't rely on PATH.
  // CRITICAL: never treat process.execPath as node when it is Electron.
  // Electron.app/.../Electron lives under node_modules in dev — a naive
  // `.includes("node")` check incorrectly selected Electron without
  // ELECTRON_RUN_AS_NODE, so desk-browser MCP never registered tools and the
  // agent fell back to Chrome/Google instead of the in-app browser.
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const exec = process.execPath;
  const execBase = path.basename(exec).toLowerCase();
  const execIsNode =
    (execBase === "node" || execBase === "node.exe") &&
    !/electron/i.test(exec);
  const nvmRoot = path.join(home, ".nvm", "versions", "node");
  let nvmNodes: string[] = [];
  try {
    if (fs.existsSync(nvmRoot)) {
      nvmNodes = fs
        .readdirSync(nvmRoot)
        .map((v) => path.join(nvmRoot, v, "bin", "node"))
        .filter((p) => fs.existsSync(p));
    }
  } catch {
    nvmNodes = [];
  }
  const candidates = [
    execIsNode ? exec : "",
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(home, ".local", "bin", "node"),
    ...nvmNodes,
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return { command: c, electronAsNode: false };
    } catch {
      // continue
    }
  }
  // Last resort: Electron-as-Node (must set ELECTRON_RUN_AS_NODE when spawning MCP).
  if (/electron/i.test(execBase) || /electron/i.test(exec)) {
    return { command: exec, electronAsNode: true };
  }
  return { command: "node", electronAsNode: false };
}

/**
 * Environment for the gateway child.
 * Prepends only the managed Grok binary directory when set — never ~/.grok/bin
 * or other global install locations (production does not use PATH discovery).
 *
 * Spreads `process.env` so main-set entitlement keys
 * (`GROKDESK_ENTITLEMENT_STATE_PATH`, `GROKDESK_LEASE_PUBLIC_JWKS`,
 * issuer/audience) reach the child. Never inject product keys, device
 * private keys, or lease JWTs.
 */
/**
 * Sync discovery of a user-local Grok CLI for unlock / review builds only.
 * Never used for production packaged admission without unlock bake.
 */
export function resolveUnlockGrokBinarySync(
  home: string = process.env.HOME || process.env.USERPROFILE || os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string | null {
  const binName = platform === "win32" ? "grok.exe" : "grok";
  const dirs =
    platform === "win32"
      ? [
          path.join(home, "AppData", "Local", "grok"),
          path.join(home, ".grok", "bin"),
          path.join(home, ".local", "bin"),
        ]
      : [
          path.join(home, ".grok", "bin"),
          path.join(home, ".local", "bin"),
          "/usr/local/bin",
          path.join(home, "bin"),
          "/opt/homebrew/bin",
        ];
  for (const dir of dirs) {
    const candidate = path.join(dir, binName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function gatewayEnv(
  electronAsNode: boolean,
  opts?: { managedBinaryPath?: string | null },
): NodeJS.ProcessEnv {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const sep = process.platform === "win32" ? ";" : ":";
  let managed = opts?.managedBinaryPath?.trim() || "";
  const current = process.env.PATH || process.env.Path || "";
  const parts = current.split(sep).filter(Boolean);
  // Keep a minimal usable PATH for node/system tools; do not inject global grok dirs.
  const baseExtras =
    process.platform === "win32"
      ? []
      : ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin", "/opt/homebrew/bin"].filter(
          (d) => !parts.includes(d),
        );
  let pathParts = [...baseExtras, ...parts];
  const bundledSkills = resolveBundledSkillsPath();
  const licensePublicKey = resolveLicensePublicKeyForGateway();
  const mcpNode = resolveMcpNodeBinary();
  const packaged =
    isPackagedElectron() || process.env.GROKDESK_PACKAGED === "1";
  // Open-source builds always open Grok admission (no product-key wall).
  // Explicit DEV_UNLOCK / bake still enables local CLI discovery and related
  // review-build helpers without weakening packaged ACP hygiene.
  const openAdmission =
    !GROKDESK_PRODUCT_KEY_ENFORCEMENT ||
    isBakedDevUnlock() ||
    (!packaged && process.env.GROKDESK_DEV_UNLOCK === "1");
  const localDevUnlock =
    isBakedDevUnlock() ||
    (!packaged && process.env.GROKDESK_DEV_UNLOCK === "1");
  // Explicit unlock builds have no managed-runtime download. Wire the user's
  // local Grok CLI so the engine is not stuck on managed_runtime_unavailable.
  if (localDevUnlock && !(managed && path.isAbsolute(managed))) {
    const unlocked = resolveUnlockGrokBinarySync(home, process.platform);
    if (unlocked) managed = unlocked;
  }
  if (managed && path.isAbsolute(managed)) {
    const dir = path.dirname(managed);
    pathParts = [dir, ...pathParts.filter((p) => p !== dir)];
  }
  // Intentionally inherits entitlement path/JWKS/issuer/audience from process.env.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: process.env.HOME || home,
    PATH: pathParts.join(sep),
    // Absolute interpreter for desk-* MCP servers written into .grok/config.toml
    GROKDESK_MCP_NODE: mcpNode.command,
    ...(mcpNode.electronAsNode ? { GROKDESK_MCP_NODE_ELECTRON: "1" } : {}),
    ...(bundledSkills ? { GROKDESK_BUNDLED_SKILLS: bundledSkills } : {}),
    ...(licensePublicKey
      ? { GROKDESK_LICENSE_PUBLIC_KEY: licensePublicKey }
      : {}),
    ...(managed && path.isAbsolute(managed)
      ? { GROKDESK_MANAGED_GROK_BINARY_RESOLVED: managed }
      : {}),
    ...(packaged ? { GROKDESK_PACKAGED: "1" } : {}),
    // Incomplete JWKS/state must not deny Grok when product keys are disabled
    // (open source) or when an explicit local/baked unlock is active.
    GROKDESK_ENTITLEMENT_FAIL_CLOSED: openAdmission
      ? "0"
      : process.env.GROKDESK_ENTITLEMENT_FAIL_CLOSED?.trim() || "1",
    GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: openAdmission ? "0" : "1",
  };
  // Never forward the legacy ambient override. Only the runtime store's
  // verified path, supplied explicitly above, may reach the gateway child.
  delete env.GROKDESK_MANAGED_GROK_BINARY;
  // Packaged binaries always strip ambient ACP/dev binary overrides unless
  // this is an explicit unlock review build (not merely open-source mode).
  if (packaged && !localDevUnlock) {
    delete env.GROKDESK_ACP;
    delete env.GROKDESK_DEV_GROK_BINARY;
  }
  if (localDevUnlock) {
    // Propagate unlock so engine-grok resolveManagedGrokBinary may also
    // fall back to a local ~/.grok install when RESOLVED is unset.
    env.GROKDESK_DEV_UNLOCK = "1";
    // With no readiness state path AND readiness fail-closed off, the runtime
    // readiness guard collapses to the underlying (null in unlock) entitlement
    // guard — so Grok is admitted without a managed-runtime install.
    delete env.GROKDESK_RUNTIME_READINESS_STATE_PATH;
  } else if (openAdmission) {
    // Open-source admission without full unlock: do not require readiness
    // state, but keep managed-runtime resolution paths intact.
    delete env.GROKDESK_RUNTIME_READINESS_STATE_PATH;
  }
  if (electronAsNode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  return env;
}

/**
 * Runs @grokdesk/gateway as a Node child. Auto-restarts on unexpected exit
 * after ready (bounded backoff). Status is exposed for the renderer banner.
 */
export class GatewayProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private seq = 0;
  private status: GatewayLifecycleStatus = "idle";
  private intentionalStop = false;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<(s: GatewayLifecycleStatus) => void>();
  private notifyListeners = new Set<
    (method: string, params: Record<string, unknown>) => void
  >();
  private spawning = false;
  private managedBinaryPath: string | null;
  private hostHandler:
    | ((method: string, params: Record<string, unknown>) => Promise<unknown>)
    | null = null;

  constructor(opts?: { managedBinaryPath?: string | null }) {
    this.managedBinaryPath = opts?.managedBinaryPath?.trim() || null;
  }

  /** Install the RuntimeStore-verified path used by the next child spawn. */
  setManagedBinaryPath(binaryPath: string): void {
    const trimmed = binaryPath.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) {
      throw new TypeError("managed binary path must be absolute");
    }
    this.managedBinaryPath = trimmed;
  }

  setHostHandler(
    fn: (
      method: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
  ): void {
    this.hostHandler = fn;
  }

  private writeToGateway(msg: unknown): void {
    this.child?.stdin.write(JSON.stringify(msg) + "\n");
  }

  private async handleHostCall(
    id: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (!this.hostHandler) throw new Error("No host handler");
      const result = await this.hostHandler(method, params);
      this.writeToGateway({ type: "host_result", id, ok: true, result });
    } catch (e) {
      this.writeToGateway({
        type: "host_result",
        id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  getStatus(): GatewayLifecycleStatus {
    return this.status;
  }

  onStatus(listener: (s: GatewayLifecycleStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Server-push notify frames from the gateway child (tasks/events/inbox/remote). */
  onNotify(
    listener: (method: string, params: Record<string, unknown>) => void,
  ): () => void {
    this.notifyListeners.add(listener);
    return () => this.notifyListeners.delete(listener);
  }

  private emitNotify(method: string, params: Record<string, unknown>): void {
    for (const l of this.notifyListeners) {
      try {
        l(method, params);
      } catch {
        // ignore
      }
    }
  }

  private setStatus(s: GatewayLifecycleStatus): void {
    if (this.status === s) return;
    this.status = s;
    mainLog("info", `gateway status=${s}`);
    for (const l of this.statusListeners) {
      try {
        l(s);
      } catch {
        // ignore
      }
    }
  }

  async start(): Promise<void> {
    if (this.child || this.spawning) return;
    this.intentionalStop = false;
    this.spawning = true;
    this.setStatus(this.restartCount > 0 ? "restarting" : "starting");

    try {
      const gatewayCli = resolveGatewayCli();
      const { command: node, electronAsNode } = resolveNodeBinary();

      this.child = spawn(node, [gatewayCli], {
        stdio: ["pipe", "pipe", "pipe"],
        env: gatewayEnv(electronAsNode, {
          managedBinaryPath: this.managedBinaryPath,
        }),
        windowsHide: true,
      });

      const rl = readline.createInterface({ input: this.child.stdout });
      rl.on("line", (line) => {
        try {
          if (Buffer.byteLength(line, "utf8") > GATEWAY_STDOUT_MAX_LINE_BYTES) {
            mainLog(
              "error",
              "[gateway]",
              `dropped oversized stdout line (>${GATEWAY_STDOUT_MAX_LINE_BYTES} bytes)`,
            );
            return;
          }
          const msg = JSON.parse(line) as {
            type?: string;
            id?: string;
            ok?: boolean;
            result?: unknown;
            error?: string;
            method?: string;
            params?: Record<string, unknown>;
          };
          if (msg.type === "ready") {
            this.ready = true;
            this.restartCount = 0;
            this.setStatus("ready");
            for (const w of this.readyWaiters) w();
            this.readyWaiters = [];
            return;
          }
          if (msg.type === "notify" && typeof msg.method === "string") {
            this.emitNotify(msg.method, msg.params ?? {});
            return;
          }
          if (
            msg.type === "host_call" &&
            msg.id != null &&
            typeof (msg as { method?: string }).method === "string"
          ) {
            const m = msg as {
              id: string;
              method: string;
              params?: Record<string, unknown>;
            };
            void this.handleHostCall(
              String(m.id),
              m.method,
              m.params ?? {},
            );
            return;
          }
          if (msg.id != null && this.pending.has(String(msg.id))) {
            const p = this.pending.get(String(msg.id))!;
            this.pending.delete(String(msg.id));
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error || "Gateway error"));
          }
        } catch {
          // ignore malformed
        }
      });

      let stderrBuf = "";
      this.child.stderr.on("data", (buf: Buffer) => {
        const text = buf.toString("utf8");
        stderrBuf = appendStderrRing(stderrBuf, text);
        mainLog("error", "[gateway]", redactSecrets(text).slice(0, 500));
      });

      const failStart = (err: Error) => {
        this.child = null;
        this.ready = false;
        for (const [, p] of this.pending) {
          p.reject(err);
        }
        this.pending.clear();
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w();
      };

      this.child.on("error", (err) => {
        failStart(err instanceof Error ? err : new Error(String(err)));
      });

      this.child.on("exit", (code) => {
        const wasReady = this.ready;
        const intentional = this.intentionalStop;
        this.child = null;
        this.ready = false;

        for (const [, p] of this.pending) {
          p.reject(new Error(`Gateway exited (${code})`));
        }
        this.pending.clear();

        if (intentional) {
          this.setStatus("idle");
          return;
        }

        if (
          shouldRestartGateway({
            intentionalStop: intentional,
            wasReady,
            restartCount: this.restartCount,
          })
        ) {
          const attempt = this.restartCount;
          this.restartCount += 1;
          const delay = restartBackoffMs(attempt);
          this.setStatus("restarting");
          mainLog(
            "warn",
            `gateway exited code=${code}; restart attempt ${this.restartCount}/${MAX_GATEWAY_RESTARTS} in ${delay}ms`,
          );
          if (this.restartTimer) clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.start().catch((e) => {
              mainLog(
                "error",
                "gateway restart failed",
                e instanceof Error ? e.message : String(e),
              );
              if (this.restartCount >= MAX_GATEWAY_RESTARTS) {
                this.setStatus("dead");
              }
            });
          }, delay);
          return;
        }

        if (wasReady) {
          this.setStatus("dead");
          mainLog("error", `gateway dead after exit code=${code}`);
        } else {
          const detail =
            stderrBuf.trim().length > 0
              ? `Gateway exited (${code}): ${redactSecrets(stderrBuf.trim()).slice(0, 500)}`
              : `Gateway exited (${code})`;
          failStart(new Error(detail));
          this.setStatus("dead");
        }
      });

      try {
        await this.waitReady(20_000);
      } catch (err) {
        const hint =
          stderrBuf.trim().length > 0
            ? ` ${redactSecrets(stderrBuf.trim()).slice(0, 500)}`
            : "";
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}. node=${node} cli=${gatewayCli}${hint}`,
        );
      }
    } finally {
      this.spawning = false;
    }
  }

  private waitReady(ms: number): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("Gateway ready timeout")),
        ms,
      );
      this.readyWaiters.push(() => {
        clearTimeout(t);
        if (this.ready) resolve();
        else reject(new Error("Gateway process failed before ready"));
      });
    });
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    if (!this.child || !this.ready) {
      throw new Error(
        this.status === "restarting" || this.status === "starting"
          ? "Gateway reconnecting"
          : this.status === "dead"
            ? "Gateway unavailable — relaunch the app"
            : "Gateway not started",
      );
    }
    // Cap concurrent in-flight RPCs (timeouts also clear entries).
    if (this.pending.size >= 128) {
      throw new Error("Gateway busy — too many in-flight requests");
    }
    const id = String(++this.seq);
    const payload = JSON.stringify({ id, method, params });
    // Default 5 minutes — long enough for heavy work RPCs, fails closed if
    // the gateway child never answers (prevents permanent pending map leaks).
    const timeoutMs = opts?.timeoutMs ?? 300_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`Gateway request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child!.stdin.write(payload + "\n");
    });
  }

  async handle(raw: unknown): Promise<unknown> {
    const req = raw as { method: string; params?: Record<string, unknown> };
    return this.request(
      req.method,
      (req.params as Record<string, unknown>) ?? {},
    );
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.child) {
      this.setStatus("idle");
      return;
    }
    try {
      await this.request("shutdown", {});
    } catch {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.child = null;
    this.ready = false;
    this.setStatus("idle");
  }

  /**
   * Explicit user/engine recovery: cancel pending restart timers, stop the
   * current child intentionally, reset bounded restart state, and start fresh.
   * Lifecycle notifications keep flowing via setStatus.
   */
  async restart(): Promise<void> {
    mainLog("info", "gateway explicit restart requested");
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    // Intentional stop so the exit handler does not auto-schedule another restart.
    await this.stop().catch(() => {
      /* best-effort stop */
    });
    this.restartCount = 0;
    this.intentionalStop = false;
    this.ready = false;
    await this.start();
  }

  /**
   * E2E-only: kill the gateway child without graceful shutdown so recovery
   * paths can be exercised. Not intentionalStop — exit handler may restart.
   */
  async crashForTest(): Promise<void> {
    mainLog("warn", "gateway crashForTest");
    const child = this.child;
    if (!child) {
      this.setStatus("idle");
      return;
    }
    this.intentionalStop = false;
    this.ready = false;
    try {
      child.kill("SIGKILL");
    } catch {
      /* */
    }
    this.child = null;
    this.setStatus("dead");
  }

  /**
   * Drain for app quit: ask the gateway to shut down gracefully, but bounded —
   * wait for the child to actually exit, and if it ignores `shutdown` within
   * `timeoutMs`, SIGKILL it so neither the gateway child nor its Grok CLI
   * grandchildren are orphaned after the Electron process exits. Unlike
   * `stop()`, this awaits real process exit and force-kills on timeout.
   */
  async shutdownForQuit(timeoutMs = 3_000): Promise<void> {
    this.intentionalStop = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) {
      this.setStatus("idle");
      return;
    }
    // The instance `exit` handler nulls this.child; keep the local ref so we can
    // still force-kill the OS process after that fires.
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    void this.request("shutdown", {}).catch(() => {
      // RPC may reject if the child is already going down — that's fine.
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([exited, timedOut]);
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this.child = null;
    this.ready = false;
    this.setStatus("idle");
  }
}

/**
 * Locate gateway CLI for monorepo dev and electron-builder asar layouts.
 */
export function resolveGatewayCli(): string {
  const candidates: string[] = [
    path.resolve(
      __dirname,
      "../../node_modules/@grokdesk/gateway/dist/cli.js",
    ),
    path.resolve(
      __dirname,
      "../../../node_modules/@grokdesk/gateway/dist/cli.js",
    ),
    path.resolve(__dirname, "../../../../packages/gateway/dist/cli.js"),
    path.resolve(__dirname, "../../../packages/gateway/dist/cli.js"),
    path.resolve(process.cwd(), "packages/gateway/dist/cli.js"),
    path.resolve(process.cwd(), "../../packages/gateway/dist/cli.js"),
  ];

  if (typeof process.resourcesPath === "string" && process.resourcesPath) {
    candidates.unshift(
      path.join(
        process.resourcesPath,
        "app.asar",
        "node_modules",
        "@grokdesk",
        "gateway",
        "dist",
        "cli.js",
      ),
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "@grokdesk",
        "gateway",
        "dist",
        "cli.js",
      ),
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Gateway CLI not found. Run pnpm --filter @grokdesk/gateway build. Tried:\n${candidates.join("\n")}`,
  );
}
