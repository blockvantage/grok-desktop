import type {
  DesktopExecArgs,
  DesktopExecResult,
  DesktopMachineSettings,
  DesktopPermissionStatus,
  DesktopStatusEvent,
} from "@grokdesk/shared";

export type BrowserExecTool =
  | "browser_open"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_screenshot"
  | "browser_read";

export type BrowserExecArgs = {
  taskId: string;
  tool: BrowserExecTool;
  args: Record<string, unknown>;
  /** Trusted gateway provenance; never sourced from model-provided tool args. */
  source?: "renderer_user" | "agent";
};

export type BrowserExecResult = {
  ok: boolean;
  output: string;
  screenshot?: string;
  url?: string;
  title?: string;
  needsApproval?: boolean;
  approvalId?: string;
};

export type BrowserConfigureArgs = {
  taskId: string;
  policy: {
    approvalMode: "strict" | "balanced" | "autopilot";
    workspaceRoots: string[];
    allowNetworkTools: boolean;
    allowShell: boolean;
  };
};

export type DesktopConfigureArgs = {
  taskId: string;
  granted: boolean;
  displayId?: string | null;
  machine: DesktopMachineSettings;
  clearSoftPause?: boolean;
};

export interface HostBridge {
  /** Policy + optional interactive approval + execute (main is sole policy owner). */
  browserExec(req: BrowserExecArgs): Promise<BrowserExecResult>;
  browserConfigure(req: BrowserConfigureArgs): Promise<void>;
  browserRememberOrigin(taskId: string, url: string): Promise<void>;
  browserResolveApproval(
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<boolean>;
  browserDestroy(taskId: string): Promise<void>;

  desktopExec(req: DesktopExecArgs): Promise<DesktopExecResult>;
  desktopConfigure(req: DesktopConfigureArgs): Promise<void>;
  desktopGetStatus(taskId: string): Promise<DesktopStatusEvent | null>;
  desktopDestroy(taskId: string): Promise<void>;
  desktopPermissions(): Promise<DesktopPermissionStatus>;
}

export class NullHostBridge implements HostBridge {
  async browserExec(): Promise<BrowserExecResult> {
    return { ok: false, output: "No host browser bridge" };
  }
  async browserConfigure(): Promise<void> {}
  async browserRememberOrigin(): Promise<void> {}
  async browserResolveApproval(): Promise<boolean> {
    return false;
  }
  async browserDestroy(): Promise<void> {}

  async desktopExec(): Promise<DesktopExecResult> {
    return {
      ok: false,
      output: "No host desktop bridge",
      code: "desktop_not_supported",
    };
  }
  async desktopConfigure(): Promise<void> {}
  async desktopGetStatus(): Promise<DesktopStatusEvent | null> {
    return null;
  }
  async desktopDestroy(): Promise<void> {}
  async desktopPermissions(): Promise<DesktopPermissionStatus> {
    return {
      captureGranted: false,
      inputGranted: false,
      captureDetail: "null bridge",
      inputDetail: "null bridge",
      platform: "other",
    };
  }
}

/**
 * Gateway → main reverse calls over JSON-lines stdio.
 */
export class StdioHostBridge implements HostBridge {
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    }
  >();
  private seq = 0;

  constructor(private write: (msg: unknown) => void) {}

  handleHostResult(msg: {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "host_result failed"));
  }

  private call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.pending.size >= 64) {
      return Promise.reject(new Error("Host bridge busy — too many in-flight calls"));
    }
    const id = `host-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ type: "host_call", id, method, params });
      const t = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Host call timeout: ${method}`));
        }
      }, 300_000);
      t.unref?.();
    });
  }

  async browserExec(req: BrowserExecArgs): Promise<BrowserExecResult> {
    return (await this.call(
      "browser.exec",
      req as unknown as Record<string, unknown>,
    )) as BrowserExecResult;
  }

  async browserConfigure(req: BrowserConfigureArgs): Promise<void> {
    await this.call(
      "browser.configure",
      req as unknown as Record<string, unknown>,
    );
  }

  async browserRememberOrigin(taskId: string, url: string): Promise<void> {
    await this.call("browser.rememberOrigin", { taskId, url });
  }

  async browserResolveApproval(
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<boolean> {
    return (await this.call("browser.resolveApproval", {
      approvalId,
      decision,
    })) as boolean;
  }

  async browserDestroy(taskId: string): Promise<void> {
    await this.call("browser.destroy", { taskId });
  }

  async desktopExec(req: DesktopExecArgs): Promise<DesktopExecResult> {
    return (await this.call(
      "desktop.exec",
      req as unknown as Record<string, unknown>,
    )) as DesktopExecResult;
  }

  async desktopConfigure(req: DesktopConfigureArgs): Promise<void> {
    await this.call(
      "desktop.configure",
      req as unknown as Record<string, unknown>,
    );
  }

  async desktopGetStatus(taskId: string): Promise<DesktopStatusEvent | null> {
    return (await this.call("desktop.status", { taskId })) as DesktopStatusEvent | null;
  }

  async desktopDestroy(taskId: string): Promise<void> {
    await this.call("desktop.destroy", { taskId });
  }

  async desktopPermissions(): Promise<DesktopPermissionStatus> {
    return (await this.call(
      "desktop.permissions",
      {},
    )) as DesktopPermissionStatus;
  }
}
