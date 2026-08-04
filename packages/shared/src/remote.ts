/**
 * RN / browser-safe remote-only surface (no node: builtins).
 * Mobile and other pure-JS clients should import `@grokdesk/shared/remote`.
 */
export * from "./remote-crypto.js";
export * from "./remote-protocol.js";
export * from "./remote-allowlist.js";
export * from "./telepresence.js";
export * from "./remote-offline-queue.js";
export * from "./remote-reconnect.js";
export * from "./remote-errors.js";
export * from "./remote-session-crypto.js";

