/**
 * Path helpers used by policy and gateway.
 * Implemented without node:path so the browser-safe shared barrel never pulls
 * a Node builtin into the renderer bundle (Vite externalizes node:path).
 */

function isAbsolutePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/")) return true;
  // Windows drive: C:\ or C:/
  return /^[A-Za-z]:[\\/]/.test(p);
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

export function assertAbsolutePath(p: string): string {
  if (!isAbsolutePath(p)) {
    throw new Error(`Path must be absolute: ${p}`);
  }
  return p;
}

export function normalizeRoot(root: string): string {
  const abs = assertAbsolutePath(root);
  const n = normalizeSlashes(abs).replace(/\/+$/, "");
  // Preserve Windows drive root "C:" → "C:/"
  if (/^[A-Za-z]:$/.test(n)) return `${n}/`;
  return n || normalizeSlashes(abs);
}

/**
 * Resolve `.` / `..` segments on an absolute path without node:path.
 */
function resolveAbsolute(p: string): string {
  const abs = assertAbsolutePath(p);
  const normalized = normalizeSlashes(abs);
  const win = /^[A-Za-z]:/.test(normalized);
  const prefix = win ? normalized.slice(0, 2) : "";
  const rest = win ? normalized.slice(2) : normalized;
  const parts = rest.split("/").filter((s) => s.length > 0 && s !== ".");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 0) out.pop();
    } else {
      out.push(part);
    }
  }
  if (win) {
    return `${prefix}/${out.join("/")}`;
  }
  return `/${out.join("/")}`;
}

export function isPathInsideRoot(target: string, root: string): boolean {
  let resolvedTarget = resolveAbsolute(target);
  let resolvedRoot = normalizeRoot(root);
  // Windows volumes are case-insensitive; compare lowercased so C:\Work and
  // c:\work are treated as the same root (posix paths stay case-sensitive).
  if (/^[A-Za-z]:/.test(resolvedTarget) || /^[A-Za-z]:/.test(resolvedRoot)) {
    resolvedTarget = resolvedTarget.toLowerCase();
    resolvedRoot = resolvedRoot.toLowerCase();
  }
  if (resolvedTarget === resolvedRoot) return true;
  // Ensure root boundary (avoid /foo matching /foobar)
  const rootPrefix = resolvedRoot.endsWith("/")
    ? resolvedRoot
    : `${resolvedRoot}/`;
  return resolvedTarget.startsWith(rootPrefix);
}

export function isPathInsideAnyRoot(target: string, roots: string[]): boolean {
  return roots.some((r) => isPathInsideRoot(target, r));
}
