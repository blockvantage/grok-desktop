/**
 * Typed remote application service — principal-bound method dispatch.
 * Separated from WebSocket transport (RemoteSessionHost) so authorization
 * does not depend on transport internals (REMOTE-01).
 *
 * Grok admission for remote `tasks.create` is enforced here (action `remote`)
 * and again inside TaskSubmissionService when that path is used — belt and
 * suspenders so remote never bypasses the lease check.
 */
import type { IpcRequest } from "@grokdesk/shared";
import { redactSecretString } from "@grokdesk/shared";
import type { Gateway } from "../index.js";
import {
  remoteRequestContext,
  type RequestContext,
} from "./request-context.js";
import type { EntitlementGuard } from "./entitlement-guard.js";
import { isEntitlementReadOnlyError } from "./entitlement-error.js";

/** Cap + redact remote error strings so phone clients never see secrets. */
function safeRemoteErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const redacted = redactSecretString(raw);
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

export interface RemoteApplicationResult {
  ok: true;
  result: unknown;
}

export interface RemoteApplicationError {
  ok: false;
  error: string;
}

/** Remote methods that admit new Grok-backed work. */
const REMOTE_GROK_ADMISSION_METHODS = new Set(["tasks.create"]);

export class RemoteApplicationService {
  constructor(
    private gateway: Gateway,
    private entitlementGuard: EntitlementGuard | null = null,
  ) {}

  /** Inject or clear the shared entitlement guard (composition root / tests). */
  setEntitlementGuard(guard: EntitlementGuard | null): void {
    this.entitlementGuard = guard;
  }

  /**
   * Execute an allowlisted, principal-bound remote RPC.
   * Device identity is always taken from the authenticated principal.
   */
  async handle(
    method: string,
    params: unknown,
    principal: {
      deviceId: string;
      machineId: string;
      requestId: string;
    },
  ): Promise<RemoteApplicationResult | RemoteApplicationError> {
    try {
      if (REMOTE_GROK_ADMISSION_METHODS.has(method)) {
        // Fail-closed when guard is null under GROKDESK_ENTITLEMENT_FAIL_CLOSED=1.
        const { requireGrokAdmission } = await import(
          "./entitlement-admission.js"
        );
        await requireGrokAdmission(this.entitlementGuard, "remote");
      }
      this.gateway.remote.assertMethodAllowed(method);
      const req = {
        id: principal.requestId,
        method,
        params: params ?? {},
      } as IpcRequest;
      // parse via gateway.handle path (Zod inside gateway parseIpcRequest at call sites)
      const { parseIpcRequest } = await import("@grokdesk/shared");
      const validated = parseIpcRequest(req);
      const ctx: RequestContext = remoteRequestContext({
        principalDeviceId: principal.deviceId,
        machineId: principal.machineId,
        requestId: principal.requestId,
      });
      const result = await this.gateway.handle(validated, ctx);
      this.gateway.remote.touchDevice(principal.deviceId);
      return { ok: true, result };
    } catch (e) {
      if (isEntitlementReadOnlyError(e)) {
        return {
          ok: false,
          error: "entitlement_read_only",
        };
      }
      return {
        ok: false,
        error: safeRemoteErrorMessage(e),
      };
    }
  }
}
