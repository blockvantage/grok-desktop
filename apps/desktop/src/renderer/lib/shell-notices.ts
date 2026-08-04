/**
 * Build shell-level notice items from gateway/auth/entitlement status (I2).
 */
import {
  noticePriority,
  type NoticeItem,
} from "@/lib/notice-priority";

export type GatewayUiStatusLike =
  | "ready"
  | "starting"
  | "restarting"
  | "dead"
  | string;

/**
 * Ordered shell notices for the App notice slot.
 * Severity ranking is owned by selectNotices / noticePriority.
 */
export function buildShellNotices(input: {
  gatewayUiStatus: GatewayUiStatusLike;
  needsReauth?: boolean;
  /** True while AccountController sign-in flow is active (shows Cancel). */
  signingIn?: boolean;
  /** License/entitlement blocks Grok operations. */
  entitlementBlocked?: boolean;
  /** Managed runtime missing or unhealthy. */
  runtimeBlocked?: boolean;
  /** Security update deadline / mandatory update. */
  securityUpdate?: boolean;
  /** Optional non-blocking update available. */
  updateAvailable?: boolean;
  /** Aggregated readiness sheet active (I11) — suppress stack of separate blockers. */
  readinessBlocked?: boolean;
}): NoticeItem[] {
  const out: NoticeItem[] = [];
  if (input.gatewayUiStatus === "dead") {
    out.push({
      id: "gateway-dead",
      kind: "gateway_dead",
      priority: noticePriority("gateway_dead"),
    });
  } else if (
    input.gatewayUiStatus === "restarting" ||
    input.gatewayUiStatus === "starting"
  ) {
    out.push({
      id: "gateway-reconnecting",
      kind: "gateway_reconnecting",
      priority: noticePriority("gateway_reconnecting"),
    });
  }

  // When the single readiness checklist is shown, do not also stack
  // entitlement/runtime/reauth banners (I11 + I2).
  if (input.readinessBlocked) {
    out.push({
      id: "readiness",
      kind: "readiness",
      priority: noticePriority("readiness"),
    });
  } else {
    if (input.entitlementBlocked) {
      out.push({
        id: "entitlement",
        kind: "entitlement",
        priority: noticePriority("entitlement"),
      });
    }
    if (input.runtimeBlocked) {
      out.push({
        id: "runtime",
        kind: "runtime",
        priority: noticePriority("runtime"),
      });
    }
    if (input.signingIn) {
      out.push({
        id: "signing-in",
        kind: "signing_in",
        priority: noticePriority("signing_in"),
      });
    }
    if (input.needsReauth && !input.signingIn) {
      out.push({
        id: "reauth",
        kind: "reauth",
        priority: noticePriority("reauth"),
      });
    }
  }

  if (input.securityUpdate) {
    out.push({
      id: "security-update",
      kind: "security_update",
      priority: noticePriority("security_update"),
    });
  } else if (input.updateAvailable) {
    out.push({
      id: "update",
      kind: "update",
      priority: noticePriority("update"),
    });
  }

  return out;
}
