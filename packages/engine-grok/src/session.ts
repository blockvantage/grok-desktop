import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  allowProjectToolSetup,
  checkRunBudget,
  createRunBudgetState,
  policyToGrokArgs,
  projectEffectiveProtection,
  runBudgetLimitsFromEnv,
  touchRunBudgetActivity,
  type RunBudgetState,
} from "@grokdesk/shared";
import {
  writeEphemeralMcpConfig,
  writeProjectMcpConfig,
  installSkillsIntoProject,
  installSkillsIntoGrokHome,
  redactSecretsForPrompt,
} from "@grokdesk/shared/node";
import type {
  EngineAdapter,
  EngineRunOptions,
  NormalizedEngineEvent,
} from "./types.js";
import { parseStreamingJsonLine } from "./events.js";
import {
  cliCommand,
  envWithManagedBinary,
  probeGrokCli,
  resolveManagedGrokBinary,
} from "./discover.js";
import { promoteSessionMediaToWorkspace } from "./session-media.js";

/**
 * Append headless `--resume` when a prior provider session id is known.
 * Pure helper for unit tests and spawn-arg assembly.
 */
export function headlessSpawnArgv(
  baseArgs: string[],
  priorProviderSessionId?: string,
): string[] {
  if (!priorProviderSessionId) return baseArgs;
  return [...baseArgs, "--resume", priorProviderSessionId];
}

/** UI locale short codes → language names for reply instruction (LANG-1). */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ja: "Japanese",
  zh: "Chinese (Simplified)",
};

export type BuildRunPromptOpts = {
  task: { goal: string; locale?: string; policySnapshot?: { workspaceRoots?: string[] } };
  systemPreamble?: string;
  extras?: string;
  primaryCwd: string;
};

type RunIntent = {
  deliverable: boolean;
  media: boolean;
  html: boolean;
  browser: boolean;
  research: boolean;
};

/** Keep capability instructions relevant so ordinary chat stays conversational. */
function classifyRunIntent(goal: string): RunIntent {
  const explanatoryQuestion =
    /^\s*(?:how|why|what|when|where|who)\b/i.test(goal) ||
    /^\s*(?:can|could|would)\s+you\s+(?:explain|describe|tell|walk\s+me\s+through|show\s+me\s+how)\b/i.test(
      goal,
    );
  const media =
    /\b(?:image|video|illustration|poster|logo|graphic|visual|photo|animation)\b/i.test(
      goal,
    ) &&
    /\b(?:generate|create|make|design|edit|transform|render|produce)\b/i.test(
      goal,
    );
  const html =
    /\b(?:website|web\s*site|landing\s+page|html|webpage|web\s+page)\b/i.test(
      goal,
    );
  const browser =
    /\b(?:open|show|preview|browse|visit|navigate|load)\b/i.test(goal) &&
    /\b(?:browser|site|website|page|url|https?)\b/i.test(goal);
  const research =
    /\b(?:research|latest|current|recent|today|news|sources?|look\s+up|find\s+online|check\s+online)\b/i.test(
      goal,
    );
  const codeChange =
    !explanatoryQuestion &&
    /\b(?:build|implement|refactor|fix|update)\b/i.test(goal);
  const artifactAction =
    /\b(?:create|write|edit|generate|design|make|produce|export|save)\b/i.test(
      goal,
    ) &&
    /\b(?:file|code|app|application|feature|component|page|website|report|document|image|video|logo|poster|script|project|readme|tests?)\b/i.test(
      goal,
    );

  return {
    deliverable: media || html || codeChange || artifactAction,
    media,
    html,
    browser: browser || html,
    research,
  };
}

/**
 * Pure prompt assembly for headless `-p` runs (unit-tested; used by GrokBuildEngine).
 */
export function buildRunPrompt(opts: BuildRunPromptOpts): string {
  const { task, systemPreamble = "", extras = "", primaryCwd } = opts;
  const intent = classifyRunIntent(task.goal);
  const extraRoots = (task.policySnapshot?.workspaceRoots ?? []).slice(1);
  const localeLine =
    task.locale && task.locale !== "en" && LANGUAGE_NAMES[task.locale]
      ? `Reply to the user in ${LANGUAGE_NAMES[task.locale]} unless they clearly write in a different language.`
      : "";
  const promptParts = [
    systemPreamble?.trim() ? `Context:\n${systemPreamble.trim()}\n` : "",
    extras,
    `Task goal:\n${task.goal}`,
    localeLine,
    "",
    `Primary workspace: ${primaryCwd}`,
    extraRoots.length
      ? `Additional project folders (read/edit project files here; do not dump chat-only media into them):\n${extraRoots.map((r) => `- ${r}`).join("\n")}`
      : "",
    "Answer conversational questions directly in a natural voice. Do not create files unless the user asked for a deliverable or file change.",
    "Avoid repetitive process narration. Share only brief progress when it materially helps, then give one clear final response.",
    intent.deliverable
      ? "Create the requested deliverables in the primary workspace. In the final response, mention only the files you actually created or changed."
      : "Give one concise, user-facing final response. Mention files only if you actually created or changed them.",
    intent.media
      ? "When you create images or videos: you MUST call image_gen / image_edit / image_to_video (or equivalent). The tool writes under the session folder; Desk will copy media into the primary workspace images/ (or videos/) directory after the run — do NOT shell-cp from $GROK_HOME/sessions (sandbox blocks that). List the tool path and the intended workspace path in your final reply. Never only describe an image without calling the tool."
      : "",
    intent.research
      ? "For current or web research, use available network or browser tools and cite the sources you relied on with direct HTTP(S) links."
      : "",
    intent.browser
      ? "The registered desk-browser MCP provides the in-app browser. Prefer its `browser_open` tool (underscore form) and never use Chrome/Chrome DevTools unless the user explicitly requests an external browser."
      : "",
    intent.html
      ? "When you create an HTML page or website, write it under the primary workspace, then call browser_open once with the absolute index.html path."
      : "",
    intent.browser
      ? "When opening or previewing a site, use browser_open once and wait for its result before summarizing. If it is unavailable or fails, report that truthfully and do not claim that the pane opened."
      : "",
  ];
  return promptParts.filter(Boolean).join("\n");
}

/**
 * Send SIGTERM, wait for exit, then SIGKILL after deadline if still alive.
 * Does not rely on `child.killed` (true after signal send, not after exit).
 */
export async function terminateChild(
  child: ChildProcess,
  deadlineMs = 2_000,
): Promise<"exited" | "killed"> {
  if (child.exitCode != null || child.signalCode != null) {
    return "exited";
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (status: "exited" | "killed") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const onExit = () => done("exited");
    child.once("exit", onExit);
    try {
      child.kill("SIGTERM");
    } catch {
      child.off("exit", onExit);
      done("exited");
      return;
    }
    const timer = setTimeout(() => {
      if (child.exitCode != null || child.signalCode != null) {
        child.off("exit", onExit);
        done("exited");
        return;
      }
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      // Wait a bit more for kill to take effect, then resolve.
      const killWait = setTimeout(() => {
        child.off("exit", onExit);
        done("killed");
      }, 500);
      killWait.unref?.();
      child.once("exit", () => {
        clearTimeout(killWait);
        done("killed");
      });
    }, deadlineMs);
    timer.unref?.();
  });
}

export interface McpServerConfig {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

/**
 * Seed an isolated GROK_HOME with auth material only (no hooks/plugins/skills).
 * Prevents uncontrolled third-party hooks while preserving login when possible.
 *
 * GROK_HOME is the **config directory** (default `~/.grok`), not the user home.
 * Auth must land at `$GROK_HOME/auth.json`. Copying into `$GROK_HOME/.grok/`
 * makes the CLI report "Not signed in" even when the user is logged in.
 */
export function seedIsolatedGrokHome(
  isolatedHome: string,
  userHome: string,
): void {
  fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
  const srcGrok = path.join(userHome, ".grok");
  // Destination IS the GROK_HOME root (equivalent to ~/.grok).
  const dstGrok = isolatedHome;
  // Copy only credential-ish files — never hooks/, plugins/, skills/, marketplaces.
  const allow = new Set([
    "auth.json",
    "credentials.json",
    "session.json",
    "token.json",
  ]);
  if (!fs.existsSync(srcGrok)) return;
  for (const name of fs.readdirSync(srcGrok)) {
    if (!allow.has(name)) continue;
    const src = path.join(srcGrok, name);
    const st = fs.statSync(src);
    if (!st.isFile()) continue;
    fs.copyFileSync(src, path.join(dstGrok, name));
    try {
      fs.chmodSync(path.join(dstGrok, name), 0o600);
    } catch {
      /* ignore */
    }
  }
}

/** Bind desk-browser / desk-desktop MCP to the running Desk task partition/id. */
export function withDeskBrowserTaskId(
  servers: McpServerConfig[],
  taskId: string,
): McpServerConfig[] {
  return servers.map((s) => {
    if (s.id === "desk-browser") {
      return {
        ...s,
        env: {
          ...(s.env ?? {}),
          GROKDESK_BROWSER_TASK_ID: taskId,
        },
      };
    }
    if (s.id === "desk-desktop") {
      return {
        ...s,
        env: {
          ...(s.env ?? {}),
          GROKDESK_DESKTOP_TASK_ID: taskId,
        },
      };
    }
    return s;
  });
}

export interface GrokBuildEngineOptions {
  binary?: string | null;
  mcpServers?: McpServerConfig[];
  skillsPaths?: string[];
}

/**
 * Production engine: spawns Grok Build CLI. Tools execute inside Grok Build,
 * not in the Desk runner (`executesOwnTools = true`).
 *
 * MCP: writes enabled servers to `<cwd>/.grok/config.toml` (CLI-native).
 * Skills: installs packs under `<cwd>/.grok/skills/` so the CLI discovers them.
 */
export class GrokBuildEngine implements EngineAdapter {
  readonly executesOwnTools = true;
  private children = new Map<string, ChildProcess>();
  private binary: string | null;
  private mcpServers: McpServerConfig[];
  private skillsPaths: string[];

  constructor(opts?: GrokBuildEngineOptions) {
    this.binary = opts?.binary ?? null;
    this.mcpServers = opts?.mcpServers ?? [];
    this.skillsPaths = opts?.skillsPaths ?? [];
  }

  /**
   * Cancel awaits process exit: SIGTERM, then SIGKILL after deadline.
   * Node's `child.killed` is true once a signal is *sent*, not when the
   * process has exited — so we must wait on the exit event.
   */
  async cancel(taskId: string, opts?: { killDeadlineMs?: number }): Promise<void> {
    const child = this.children.get(taskId);
    if (!child) return;
    const deadlineMs = opts?.killDeadlineMs ?? 2_000;
    await terminateChild(child, deadlineMs);
    this.children.delete(taskId);
  }

  async run(options: EngineRunOptions): Promise<void> {
    const { task, systemPreamble, onEvent, browserSessionId } = options;
    // Default isolate unless explicitly inheriting user Grok config.
    const isolateGrokHome =
      options.isolateGrokHome ??
      process.env.GROKDESK_INHERIT_USER_GROK !== "1";

    // Immediate UI feedback — setup (MCP/skills/binary) can take seconds and
    // previously left the stream empty on "Getting started".
    await onEvent({
      type: "step",
      title: "Starting session",
      status: "start",
    });
    await onEvent({
      type: "run_progress",
      message: "Starting Grok… preparing tools and workspace.",
    });

    const binary =
      this.binary ??
      (await resolveManagedGrokBinary({ env: process.env }));
    if (!binary) {
      await onEvent({
        type: "error",
        message: "managed_runtime_unavailable",
      });
      return;
    }

    // Atomic preflight: version/capability probe before any workspace mutation.
    let probe;
    try {
      probe = await probeGrokCli(binary);
      await onEvent({
        type: "run_progress",
        message: probe.version
          ? `Grok CLI ${probe.version} — probing capabilities…`
          : "Grok CLI found — probing capabilities…",
      });
    } catch (e) {
      await onEvent({
        type: "error",
        message: `Grok CLI preflight failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const primaryCwd =
      task.policySnapshot.workspaceRoots[0] ?? process.cwd();

    // T5: project-scoped MCP/skills only when folder is trusted.
    const projectToolsOk = allowProjectToolSetup({
      workspacePath: primaryCwd,
      trustedFolders: options.trustedFolders ?? [],
    });

    // Only the managed binary directory is prepended — never global ~/.grok/bin.
    const env: NodeJS.ProcessEnv = envWithManagedBinary(binary, process.env);
    let isolatedHome: string | null = null;
    if (isolateGrokHome) {
      isolatedHome = fs.mkdtempSync(
        path.join(os.tmpdir(), "grokdesk-grok-home-"),
      );
      try {
        seedIsolatedGrokHome(isolatedHome, os.homedir());
      } catch {
        /* auth copy best-effort */
      }
      env.GROK_HOME = isolatedHome;
      await onEvent({
        type: "run_progress",
        message:
          "Isolated Grok profile (user hooks/plugins not inherited). Set GROKDESK_INHERIT_USER_GROK=1 for compatibility mode.",
      });
    } else {
      await onEvent({
        type: "run_progress",
        message:
          "Inherited user Grok configuration mode — third-party hooks may run outside Desk policy.",
      });
    }

    // Atomic provider/config preflight: enabled MCP must write successfully
    // or the run aborts (no contradictory half-configured start).
    const enabledMcpCount = this.mcpServers.filter((m) => m.enabled).length;
    try {
      const serversForTask = withDeskBrowserTaskId(
        this.mcpServers,
        browserSessionId ?? task.id,
      );
      if (isolatedHome) {
        // Always clear Desk-known project MCP rows so untrusted project config
        // cannot shadow ephemeral isolated home entries.
        writeProjectMcpConfig(
          primaryCwd,
          serversForTask.map((server) => ({ ...server, enabled: false })),
          process.env,
        );
        // Desk-owned tools live in private GROK_HOME (not project trust).
        writeEphemeralMcpConfig(serversForTask, process.env, isolatedHome);
      } else if (projectToolsOk) {
        // Inherit mode: only write project MCP when folder is trusted (T5).
        writeProjectMcpConfig(primaryCwd, serversForTask, process.env);
      } else {
        await onEvent({
          type: "run_progress",
          message:
            "Folder not trusted — project MCP not written. Trust this folder in Desk to enable project tools.",
        });
      }
    } catch (e) {
      if (isolatedHome) {
        fs.rmSync(isolatedHome, { recursive: true, force: true });
      }
      await onEvent({
        type: "error",
        message: `Failed to write MCP config (aborting run): ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    try {
      // Desk-owned skills always land in isolated GROK_HOME so image/marketing
      // packs work even when the project folder is not trusted.
      if (this.skillsPaths.length > 0 && isolatedHome) {
        const n = installSkillsIntoGrokHome(isolatedHome, this.skillsPaths);
        if (n.length > 0) {
          await onEvent({
            type: "run_progress",
            message: `Desk skills ready (${n.length} pack${n.length === 1 ? "" : "s"}).`,
          });
        }
      }
      // T5: also install into the project when trusted (project-local discovery).
      if (this.skillsPaths.length > 0 && projectToolsOk) {
        installSkillsIntoProject(primaryCwd, this.skillsPaths);
      } else if (
        this.skillsPaths.length > 0 &&
        !projectToolsOk &&
        !isolatedHome
      ) {
        await onEvent({
          type: "run_progress",
          message:
            "Folder not trusted — project skills not installed. Trust this folder to enable project skills.",
        });
      } else if (
        this.skillsPaths.length > 0 &&
        !projectToolsOk &&
        isolatedHome
      ) {
        // Soft notice: project-local install skipped; Desk skills still in GROK_HOME.
        await onEvent({
          type: "run_progress",
          message:
            "Project folder not trusted — using Desk skills only (trust the folder for project-local skills).",
        });
      }
    } catch (e) {
      if (this.skillsPaths.length > 0 && (projectToolsOk || isolatedHome)) {
        if (isolatedHome) {
          fs.rmSync(isolatedHome, { recursive: true, force: true });
        }
        await onEvent({
          type: "error",
          message: `Failed to install skills (aborting run): ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }
    }

    // T1: pass --sandbox only when probe reports support (omit otherwise).
    const flagArgs = policyToGrokArgs({
      policy: task.policySnapshot,
      model: task.model,
      effort: task.effort,
      primaryCwd,
      noAutoUpdate: probe.supportsNoAutoUpdate,
      supportsSandbox: probe.supportsSandbox,
    });

    // T3: emit protection snapshot from the same args used to spawn.
    const protection = projectEffectiveProtection({
      policy: task.policySnapshot,
      primaryCwd,
      supportsSandbox: probe.supportsSandbox,
      isolateGrokHome,
      executesOwnTools: true,
      spawnArgs: flagArgs,
    });
    await onEvent({
      type: "session_meta",
      protection: {
        spawnArgs: protection.spawnArgs,
        supportsSandbox: probe.supportsSandbox,
        isolateGrokHome,
        executesOwnTools: true,
      },
    });

    const extras = this.buildExtrasPreamble();
    const prompt = buildRunPrompt({
      task,
      systemPreamble,
      extras,
      primaryCwd,
    });

    const args = headlessSpawnArgv(
      [
        "-p",
        prompt,
        "--output-format",
        "streaming-json",
        ...flagArgs,
      ],
      options.priorProviderSessionId,
    );

    // Diagnostic only — CLI reads .grok/config.toml, not this env var.
    if (enabledMcpCount > 0) {
      env.GROKDESK_MCP_COUNT = String(enabledMcpCount);
    }
    if (this.skillsPaths.length > 0) {
      env.GROKDESK_SKILLS_PATHS = this.skillsPaths.join(path.delimiter);
    }
    if (probe.version) {
      env.GROKDESK_CLI_VERSION = probe.version;
    }

    await onEvent({
      type: "step",
      title: "Grok Build session",
      status: "start",
    });
    await onEvent({
      type: "run_progress",
      message: "Session ready — working on your goal.",
    });

    // I7: wall-clock + idle budgets (shared env resolver — same as TaskRunner).
    const runStartedAtMs = Date.now();
    let budgetState: RunBudgetState = createRunBudgetState(
      runStartedAtMs,
      runBudgetLimitsFromEnv(process.env),
    );

    await new Promise<void>((resolve, reject) => {
      const { command, args: spawnArgs } = cliCommand(binary, args);
      const child = spawn(command, spawnArgs, {
        cwd: primaryCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.children.set(task.id, child);

      let stdoutBuf = "";
      let stderrBuf = "";
      let aborted = false;
      let settled = false;
      // Grok Build often runs tools without streaming tool_use events — only
      // thought/text. Without a heartbeat the Desk UI looks frozen mid-command.
      let lastStreamAt = Date.now();
      let lastHeartbeatAt = 0;
      const HEARTBEAT_MS = 12_000;

      // Serialize ALL async onEvent work. Previously stdout used fire-and-forget
      // `void handleLine()` so process close could mark the task done while
      // earlier lines were still being applied — sidebar showed Done mid-run.
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (fn: () => Promise<void>): Promise<void> => {
        chain = chain.then(fn, fn);
        return chain;
      };

      /**
       * image_gen writes under $GROK_HOME/sessions/.../images; isolated homes
       * are deleted on finish. Promote media into the workspace first so harvest
       * (and the user) can see the files. 30s slack matches harvestSinceMs.
       */
      const promoteSessionMedia = async () => {
        const mediaHome = isolatedHome ?? env.GROK_HOME;
        if (!mediaHome || typeof mediaHome !== "string") return;
        // Prefer managed chat workspace for deliverables when present (avoids
        // dumping media into large user repos); else primary cwd.
        const roots = task.policySnapshot.workspaceRoots ?? [];
        const managed = roots.find((r) =>
          /GrokDesk[/\\]workspaces[/\\]grok-chat/i.test(r),
        );
        const destRoot = managed ?? primaryCwd;
        let promoted: ReturnType<typeof promoteSessionMediaToWorkspace> = [];
        try {
          promoted = promoteSessionMediaToWorkspace({
            grokHome: mediaHome,
            destRoot,
            sinceMs: runStartedAtMs - 30_000,
          });
        } catch {
          return;
        }
        if (promoted.length === 0) return;
        const where = path.join(destRoot, "images");
        await onEvent({
          type: "run_progress",
          message: `Saved ${promoted.length} image/video file(s) under ${where}`,
        });
        for (const file of promoted) {
          await onEvent({
            type: "artifact",
            title: file.name,
            path: file.destPath,
            kind: "media",
          });
        }
      };

      const finish = async (err?: Error) => {
        if (settled) return;
        settled = true;
        if (isolatedHome) {
          try {
            fs.rmSync(isolatedHome, { recursive: true, force: true });
          } catch {
            /* best-effort cleanup */
          }
        }
        clearInterval(heartbeat);
        this.children.delete(task.id);
        if (err) reject(err);
        else resolve();
      };

      const stopForBudget = async (message: string, code: string) => {
        if (aborted || settled) return;
        aborted = true;
        await onEvent({
          type: "error",
          message: `${code}: ${message}`,
        });
        void terminateChild(child, 2_000);
      };

      const handleLine = async (line: string) => {
        if (aborted) return;
        const events = parseStreamingJsonLine(line);
        if (events.length > 0) {
          lastStreamAt = Date.now();
          budgetState = touchRunBudgetActivity(budgetState, lastStreamAt);
        }
        for (const ev of events) {
          const signal = await onEvent(ev);
          if (signal === "abort") {
            aborted = true;
            void terminateChild(child, 2_000);
            break;
          }
        }
      };

      const heartbeat = setInterval(() => {
        if (aborted || settled) return;
        const now = Date.now();
        const budget = checkRunBudget(budgetState, now);
        if (!budget.ok) {
          void enqueue(() => stopForBudget(budget.message, budget.code));
          return;
        }
        const silentFor = now - lastStreamAt;
        if (silentFor < HEARTBEAT_MS) return;
        if (now - lastHeartbeatAt < HEARTBEAT_MS) return;
        lastHeartbeatAt = now;
        void enqueue(async () => {
          if (aborted || settled) return;
          // I7: synthetic progress while the child is still running counts as
          // activity so long silent tools are not killed by idle budget.
          budgetState = touchRunBudgetActivity(budgetState, Date.now());
          const signal = await onEvent({
            type: "run_progress",
            message: "Still working on tools in the background…",
          });
          if (signal === "abort") {
            aborted = true;
            void terminateChild(child, 2_000);
          }
        });
      }, 4_000);
      heartbeat.unref?.();

      const MAX_STDERR_BYTES = 256 * 1024;
      const MAX_LINE_CHARS = 512 * 1024;

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        // Bound residual buffer growth on pathological streams.
        if (stdoutBuf.length > MAX_LINE_CHARS * 2) {
          stdoutBuf = stdoutBuf.slice(-MAX_LINE_CHARS);
        }
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const clipped =
            line.length > MAX_LINE_CHARS
              ? line.slice(0, MAX_LINE_CHARS) + "…[truncated]"
              : line;
          void enqueue(() => handleLine(clipped));
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderrBuf.length >= MAX_STDERR_BYTES) return;
        const next = chunk.toString("utf8");
        const room = MAX_STDERR_BYTES - stderrBuf.length;
        stderrBuf += next.length > room ? next.slice(0, room) : next;
      });

      child.on("error", (err) => {
        void enqueue(async () => {
          try {
            await promoteSessionMedia();
          } catch {
            /* best-effort */
          }
          await onEvent({ type: "error", message: err.message });
          await finish();
        });
      });

      child.on("close", (code) => {
        void enqueue(async () => {
          // Drain residual stdout before completion so no event is dropped
          // after we resolve run() (runner would flip status to done).
          if (stdoutBuf.trim()) await handleLine(stdoutBuf);
          stdoutBuf = "";
          // Promote session media BEFORE done/cleanup so harvest + UI see files
          // while isolated GROK_HOME still exists.
          if (!aborted) {
            try {
              await promoteSessionMedia();
            } catch {
              /* best-effort */
            }
          }
          if (code && code !== 0 && !aborted) {
            const msg =
              stderrBuf.trim() || `Grok Build exited with code ${code}`;
            await onEvent({ type: "error", message: msg.slice(0, 2000) });
          } else if (!aborted) {
            await onEvent({
              type: "step",
              title: "Grok Build session",
              status: "end",
            });
            await onEvent({
              type: "done",
              summary:
                code === 0
                  ? "Grok Build completed"
                  : `Grok Build finished (code ${code})`,
            });
          }
          await finish();
        });
      });
    });
  }

  /** Expose configured MCP/skills for tests and diagnostics. */
  getEngineExtras(): {
    mcpServers: McpServerConfig[];
    skillsPaths: string[];
  } {
    return {
      mcpServers: this.mcpServers,
      skillsPaths: this.skillsPaths,
    };
  }

  /**
   * Prompt context only — never full command lines with secrets.
   * desk-defaults skill body is inlined; other packs are name+description.
   */
  private buildExtrasPreamble(): string {
    const parts: string[] = [];
    const enabled = this.mcpServers.filter((m) => m.enabled);
    if (enabled.length > 0) {
      parts.push(
        "MCP connectors are enabled for this workspace via .grok/config.toml.",
        "Discover tools with search_tool and call them with use_tool when relevant.",
        "Enabled connectors: " + enabled.map((m) => m.id).join(", ") + ".",
      );
    }

    for (const skillsDir of this.skillsPaths) {
      try {
        if (!fs.existsSync(skillsDir)) continue;
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const ent of entries) {
          const skillMd = ent.isDirectory()
            ? path.join(skillsDir, ent.name, "SKILL.md")
            : ent.name === "SKILL.md"
              ? path.join(skillsDir, ent.name)
              : null;
          if (!skillMd || !fs.existsSync(skillMd)) continue;
          const body = fs.readFileSync(skillMd, "utf8");
          const name = ent.isDirectory() ? ent.name : path.basename(skillsDir);
          if (name === "desk-defaults" || /name:\s*desk-defaults/i.test(body)) {
            parts.push(
              `Skill (always apply) desk-defaults:\n${redactSecretsForPrompt(body.slice(0, 4000))}`,
            );
          } else {
            const desc = extractSkillDescription(body) || name;
            parts.push(
              `Available skill "${name}": ${desc} (loaded under .grok/skills — use when relevant).`,
            );
          }
        }
      } catch {
        // ignore unreadable skills paths
      }
    }
    return parts.length ? parts.join("\n\n") + "\n" : "";
  }
}

function extractSkillDescription(skillMd: string): string {
  const fm = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const d = fm[1]!.match(/^description:\s*(.+)$/m);
    if (d) return d[1]!.trim().replace(/^["']|["']$/g, "");
  }
  const para = skillMd
    .replace(/^---[\s\S]*?---\s*/, "")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  return para ? para.slice(0, 200) : "";
}

/** Stable error code when no Desk-managed Grok binary is available. */
export const MANAGED_RUNTIME_UNAVAILABLE = "managed_runtime_unavailable";

/**
 * Non-running production stand-in: emits a truthful unavailable error only.
 * Never simulates success, tools, or artifacts.
 */
export class ManagedRuntimeUnavailableEngine implements EngineAdapter {
  readonly executesOwnTools = true;
  readonly unavailableReason = MANAGED_RUNTIME_UNAVAILABLE;

  async cancel(_taskId: string): Promise<void> {
    /* no child process */
  }

  async run(options: EngineRunOptions): Promise<void> {
    await options.onEvent({
      type: "error",
      message: MANAGED_RUNTIME_UNAVAILABLE,
    });
  }
}

export type CreateDefaultEngineOptions = {
  /**
   * Absolute path to the Desk-managed Grok binary.
   * When omitted, {@link resolveManagedGrokBinary} reads env
   * (`GROKDESK_MANAGED_GROK_BINARY` / unpackaged `GROKDESK_DEV_GROK_BINARY`).
   * Never discovers global PATH installs.
   */
  managedBinaryPath?: string | null;
  mcpServers?: McpServerConfig[];
  skillsPaths?: string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * Production engine factory: requires an explicit absolute managed binary.
 * Returns {@link ManagedRuntimeUnavailableEngine} when unavailable.
 * Test engines must be injected from `@grokdesk/engine-testkit`.
 */
export async function createDefaultEngine(
  opts?: CreateDefaultEngineOptions,
): Promise<EngineAdapter> {
  const binary = await resolveManagedGrokBinary({
    managedBinaryPath: opts?.managedBinaryPath,
    env: opts?.env ?? process.env,
  });
  if (!binary) {
    return new ManagedRuntimeUnavailableEngine();
  }
  return new GrokBuildEngine({
    binary,
    mcpServers: opts?.mcpServers,
    skillsPaths: opts?.skillsPaths,
  });
}

/** Prepend managed binary directory onto env for child processes. */
export function processEnvForManagedBinary(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return envWithManagedBinary(binary, env);
}
