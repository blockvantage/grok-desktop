export {
  STABLE_ERROR_CODES,
  stableErrorCodes,
  STABLE_ERROR_MESSAGES,
  STABLE_ERROR_STATUS,
  isStableErrorCode,
  type StableErrorCode,
} from "./errors.js";

export {
  ENTITLEMENT_STATES,
  DESKTOP_LICENSE_STATES,
  ENTITLEMENT_CAPABILITY_CATEGORIES,
  GROK_OPERATION_ALLOWED_STATES,
  type EntitlementState,
  type DesktopLicenseState,
  type EntitlementCapabilityCategory,
} from "./states.js";

export {
  CANONICAL_TARGETS,
  isCanonicalTarget,
  type CanonicalTarget,
} from "./targets.js";

export {
  ENTITLEMENT_MAIN_IPC_CHANNELS,
  type EntitlementActivateParams,
  type EntitlementDeviceSummaryDto,
  type EntitlementMainIpcChannel,
  type EntitlementRecoveryAction,
  type EntitlementStatusDto,
} from "./dto.js";
