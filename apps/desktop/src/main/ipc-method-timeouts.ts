/**
 * Per-method RPC deadlines from main → gateway.
 * Short reads / durable acceptance: 10–15s.
 * Long asset / runtime / update operations keep longer budgets.
 */

export const DEFAULT_GATEWAY_TIMEOUT_MS = 15_000;
export const LONG_GATEWAY_TIMEOUT_MS = 300_000;

const LONG_METHODS = new Set([
  "workspace.readAsset",
  "workspace.prepareAsset",
  "workspace.readFile",
  "workspace.listFiles",
  "chats.exportMarkdown",
  "auth.signIn",
  "auth.usage",
  "tasks.create", // may stage attachments + acceptance; still bounded below default long
]);

/** Methods that should fail fast if the engine is wedged. */
const SHORT_METHODS = new Set([
  "tasks.list",
  "tasks.get",
  "events.list",
  "events.page",
  "outbox.list",
  "outbox.summary",
  "outbox.enqueue",
  "outbox.update",
  "outbox.remove",
  "outbox.retry",
  "outbox.sendNow",
  "auth.status",
  "settings.get",
  "tray.status",
  "inbox.list",
  "memory.list",
  "schedule.list",
  "artifacts.list",
  "models.list",
  "rolePacks.list",
]);

/**
 * Resolve timeout for a gateway method.
 * Durable acceptance / short reads: 10–15s; long assets retain 5 minutes.
 */
export function gatewayMethodTimeoutMs(method: string): number {
  if (SHORT_METHODS.has(method)) return 12_000;
  if (method === "tasks.create" || method === "tasks.approve") return 15_000;
  if (LONG_METHODS.has(method)) return LONG_GATEWAY_TIMEOUT_MS;
  // Default: medium — do not hang forever on unknown methods.
  return DEFAULT_GATEWAY_TIMEOUT_MS;
}
