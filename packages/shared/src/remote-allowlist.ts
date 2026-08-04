const ALLOWED = new Set<string>([
  "tasks.create",
  "tasks.list",
  "tasks.get",
  "tasks.cancel",
  "tasks.setTitle",
  "tasks.delete",
  "tasks.approve",
  "tasks.pauseAll",
  "tasks.resumeAll",
  "events.list",
  "inbox.list",
  "inbox.markRead",
  "inbox.dismiss",
  "artifacts.list",
  "tray.status",
  "rolePacks.list",
  "models.list",
  // settings.get intentionally NOT allowlisted — full settings includes license + MCP secrets
  "workspace.ensureTemp",
  "schedule.list",
  "schedule.create",
  "schedule.setEnabled",
  "memory.list",
  "memory.upsert",
  "memory.delete",
  "remote.status",
  "remote.devices.list",
  /** CX-14: phone rotates ECDH device key over the live channel. */
  "remote.rekey",
  "remote.telepresence.start",
  "remote.telepresence.stop",
  "remote.telepresence.setQuality",
  "remote.telepresence.status",
  "remote.telepresence.listDisplays",
  "remote.telepresence.input",
]);

export function isRemoteAllowedMethod(method: string): boolean {
  return ALLOWED.has(method);
}

export function listRemoteAllowedMethods(): string[] {
  return [...ALLOWED].sort();
}
