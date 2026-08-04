/**
 * App-managed temporary chat workspaces under dataDir/workspaces.
 * Never OS temp, never inside user project trees (Phase 6 extract).
 */
import fs from "node:fs";
import path from "node:path";

/** Sanitize a label for use in a directory name. */
export function sanitizeWorkspaceLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "chat";
}

/**
 * Create a unique workspace folder under `{dataDir}/workspaces/grok-{label}-*`.
 */
export function ensureTempWorkspace(
  dataDir: string,
  label = "chat",
  opts?: {
    mkdirSync?: typeof fs.mkdirSync;
    mkdtempSync?: typeof fs.mkdtempSync;
  },
): string {
  const mkdirSync = opts?.mkdirSync ?? fs.mkdirSync.bind(fs);
  const mkdtempSync = opts?.mkdtempSync ?? fs.mkdtempSync.bind(fs);
  const safe = sanitizeWorkspaceLabel(label);
  const base = path.join(dataDir, "workspaces");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, `grok-${safe}-`));
}

/**
 * Resolve workspace roots for a new task:
 * - Follow-ups inherit parent roots when present.
 * - When the user chose a project folder, that folder is **primary** (cwd +
 *   deliverable write target) so project images/files land there and the chat
 *   groups under that folder — not under "Quick chats".
 * - A managed chat workspace is still created: primary when no user folder,
 *   otherwise attached as a secondary root for chat-only scratch.
 */
export function resolveTaskWorkspaceRoots(input: {
  dataDir: string;
  workspaceRoots?: string[];
  parentRoots?: string[] | null;
  ensureTemp?: (label: string) => string;
}): string[] {
  if (input.parentRoots && input.parentRoots.length > 0) {
    return input.parentRoots.map((r) => path.resolve(r));
  }
  const ensure =
    input.ensureTemp ??
    ((label: string) => ensureTempWorkspace(input.dataDir, label));
  const managed = ensure("chat");
  const userRoots = (input.workspaceRoots ?? [])
    .filter((r) => typeof r === "string" && r.trim())
    .map((r) => path.resolve(r.trim()))
    .filter((r) => r !== path.resolve(managed));
  // User project first so deliverables (images, reports) write into the project
  // the user pointed at — managed scratch alone is for folder-less chats.
  if (userRoots.length > 0) return [...userRoots, managed];
  return [managed];
}

/**
 * Startup recovery for a process killed between temp-root allocation and task
 * acceptance. Only direct, empty, non-symlink managed roots with no durable
 * task reference are removed.
 */
export function cleanupEmptyOrphanWorkspaces(input: {
  dataDir: string;
  referencedRoots: Iterable<string>;
}): string[] {
  const base = path.resolve(input.dataDir, "workspaces");
  if (!fs.existsSync(base)) return [];
  if (
    fs.lstatSync(base).isSymbolicLink() ||
    !fs.statSync(base).isDirectory()
  ) {
    return [];
  }
  const dataReal = fs.realpathSync(path.resolve(input.dataDir));
  const baseReal = fs.realpathSync(base);
  if (baseReal !== path.join(dataReal, "workspaces")) return [];
  const referenced = new Set(
    [...input.referencedRoots].map((root) => path.resolve(root)),
  );
  const removed: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    // Exact shape produced by mkdtemp("grok-<sanitized-label>-").
    if (!/^grok-[A-Za-z0-9_-]{1,32}-[A-Za-z0-9]{6}$/.test(entry.name)) {
      continue;
    }
    const candidate = path.join(base, entry.name);
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (referenced.has(candidate)) continue;
      if (fs.readdirSync(candidate).length !== 0) continue;
      fs.rmdirSync(candidate);
      removed.push(candidate);
    } catch {
      // Races and permission failures are harmless; leave the directory alone.
    }
  }
  return removed;
}
