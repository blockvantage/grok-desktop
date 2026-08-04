/**
 * Sandbox-safe entry point for renderer/preload code.
 *
 * The preload script runs in a SANDBOXED context (`sandbox: true`), where
 * `require` only resolves a tiny whitelist (electron/events/timers/url).
 * Importing the `@grokdesk/shared` barrel drags in Node-only modules
 * (skills-resolve, mcp-config-write) that `require("node:fs")` at load time,
 * which throws in the sandbox and aborts the preload before it can expose the
 * IPC bridge. This leaf re-exports ONLY the pure channel-name constants, so the
 * bundled preload never pulls in `fs`. Keep this module free of any runtime
 * import that touches Node built-ins.
 */
export {
  ENTITLEMENT_MAIN_IPC_CHANNELS,
  type EntitlementMainIpcChannel,
} from "./entitlements/dto.js";
export {
  UPDATE_MAIN_IPC_CHANNELS,
  type UpdateMainIpcChannel,
} from "./updates/dto.js";
