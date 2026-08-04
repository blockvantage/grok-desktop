/**
 * Copy image/audio attachments into the managed primary workspace.
 * Non-image files stay path references (no copy).
 * Writes attachments/manifest.json so the engine preamble can list them
 * without polluting the stored user-visible goal.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  MAX_ATTACHMENTS,
  buildAttachmentsPromptBlock,
  isAllowedAttachmentSize,
  isPathInsideRoot,
  sanitizeAttachmentFileName,
  type AttachmentPromptInput,
  type TaskAttachment,
} from "@grokdesk/shared";

export const ATTACHMENTS_DIR = "attachments";
export const ATTACHMENTS_MANIFEST = "manifest.json";

/**
 * Cap retained prior entries when merging manifests. Staging still enforces
 * MAX_ATTACHMENTS per turn; this bounds a corrupted/grown on-disk history.
 */
export const MAX_MANIFEST_ENTRIES = 64;
/** Reject absurdly large attachment manifests before JSON.parse. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

export function attachmentsManifestPath(primaryRoot: string): string {
  return path.join(primaryRoot, ATTACHMENTS_DIR, ATTACHMENTS_MANIFEST);
}

function readManifestArray(manifestFile: string): AttachmentPromptInput[] {
  if (!fs.existsSync(manifestFile)) return [];
  try {
    const st = fs.statSync(manifestFile);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return [];
    const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (x): x is AttachmentPromptInput =>
          x != null &&
          typeof x === "object" &&
          typeof (x as AttachmentPromptInput).id === "string" &&
          typeof (x as AttachmentPromptInput).name === "string",
      )
      .slice(0, MAX_MANIFEST_ENTRIES);
  } catch {
    return [];
  }
}

export function stageTaskAttachments(
  primaryRoot: string,
  items: TaskAttachment[],
): TaskAttachment[] {
  if (items.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`);
  }
  const destDir = prepareSafeAttachmentsDir(primaryRoot);
  const destDirReal = fs.realpathSync(destDir);
  const used = new Set<string>();

  const staged = items.map((item) => {
    const retainedPath = item.stagedPath
      ? path.resolve(item.stagedPath)
      : null;
    let retainedInWorkspace = false;
    let retainedReal: string | null = null;
    if (retainedPath && fs.existsSync(retainedPath)) {
      try {
        retainedReal = fs.realpathSync(retainedPath);
        retainedInWorkspace =
          isPathInsideRoot(retainedReal, destDirReal) &&
          fs.statSync(retainedReal).isFile();
      } catch {
        retainedInWorkspace = false;
        retainedReal = null;
      }
    }
    const abs = retainedInWorkspace
      ? retainedReal!
      : path.resolve(item.sourcePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`Attachment not found: ${item.name}`);
    }
    const size = fs.statSync(abs).size;
    if (!isAllowedAttachmentSize(item.kind, size)) {
      throw new Error(`Attachment too large: ${item.name}`);
    }
    if (item.kind === "file") {
      return { ...item, sourcePath: abs, sizeBytes: size };
    }
    if (retainedInWorkspace) {
      used.add(abs);
      return { ...item, stagedPath: abs, sizeBytes: size };
    }
    // image + audio → copy into managed attachments/ (use realpath base so
    // macOS /tmp → /private/tmp does not fail the confine check).
    let name = sanitizeAttachmentFileName(item.name);
    let candidate = path.join(destDirReal, name);
    let n = 1;
    while (used.has(candidate) || fs.existsSync(candidate)) {
      const ext = path.extname(name);
      const stem = path.basename(name, ext);
      name = `${stem}-${n}${ext}`;
      candidate = path.join(destDirReal, name);
      n += 1;
    }
    // Defense-in-depth: never write outside the attachments directory.
    const resolvedCandidate = path.resolve(candidate);
    if (!isPathInsideRoot(resolvedCandidate, destDirReal)) {
      throw new Error(`Attachment path escapes workspace: ${item.name}`);
    }
    fs.copyFileSync(abs, candidate);
    used.add(candidate);
    return {
      ...item,
      sourcePath: abs,
      stagedPath: candidate,
      sizeBytes: size,
      name,
    };
  });

  writeAttachmentsManifest(primaryRoot, staged);
  return staged;
}

/**
 * Validate inputs and choose stable final paths without touching the
 * workspace. Safe to run before durable task acceptance.
 */
export function planTaskAttachments(
  primaryRoot: string,
  items: TaskAttachment[],
): TaskAttachment[] {
  if (items.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`);
  }
  const destDir = path.resolve(primaryRoot, ATTACHMENTS_DIR);
  const plannedPaths = new Set<string>();
  return items.map((item) => {
    const retainedPath = item.stagedPath
      ? path.resolve(item.stagedPath)
      : null;
    const retainedInWorkspace = Boolean(
      retainedPath &&
        isPathInside(retainedPath, destDir) &&
        fs.existsSync(retainedPath) &&
        fs.statSync(retainedPath).isFile(),
    );
    const sourcePath = retainedInWorkspace
      ? retainedPath!
      : path.resolve(item.sourcePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Attachment not found: ${item.name}`);
    }
    const sourceStat = fs.statSync(sourcePath);
    const size = sourceStat.size;
    if (!isAllowedAttachmentSize(item.kind, size)) {
      throw new Error(`Attachment too large: ${item.name}`);
    }
    const bytes = readExactlyBounded(sourcePath, size, item.name);
    const contentSha256 = sha256(bytes);
    if (item.kind === "file") {
      return { ...item, sourcePath, sizeBytes: size, contentSha256 };
    }
    if (retainedInWorkspace) {
      return {
        ...item,
        sourcePath,
        stagedPath: sourcePath,
        sizeBytes: size,
        contentSha256,
      };
    }

    const name = sanitizeAttachmentFileName(item.name);
    const identity = createHash("sha256")
      .update(`${item.id}\0${contentSha256}`)
      .digest("hex")
      .slice(0, 20);
    const stagedPath = path.join(destDir, `${identity}-${name}`);
    if (!isPathInside(stagedPath, destDir)) {
      throw new Error(`Attachment destination escapes workspace: ${item.name}`);
    }
    if (plannedPaths.has(stagedPath)) {
      throw new Error(`Duplicate attachment id: ${item.id}`);
    }
    plannedPaths.add(stagedPath);
    return {
      ...item,
      name,
      sourcePath,
      stagedPath,
      sizeBytes: size,
      contentSha256,
    };
  });
}

/** Materialize an accepted attachment plan; safe to repeat after a crash. */
export function finalizeTaskAttachments(
  primaryRoot: string,
  items: TaskAttachment[],
): void {
  if (items.length === 0) return;
  const destDir = prepareSafeAttachmentsDir(primaryRoot);
  for (const item of items) {
    if (item.kind === "file") continue;
    if (!item.stagedPath) {
      throw new Error(`Accepted attachment has no staged path: ${item.name}`);
    }
    const stagedPath = path.resolve(item.stagedPath);
    if (!isPathInside(stagedPath, destDir)) {
      throw new Error(`Accepted attachment path escapes workspace: ${item.name}`);
    }
    if (path.dirname(stagedPath) !== destDir) {
      throw new Error(`Accepted attachment path has unsafe parent: ${item.name}`);
    }
    assertSafeAttachmentsDir(primaryRoot, destDir);
    if (fs.existsSync(stagedPath) && fs.lstatSync(stagedPath).isSymbolicLink()) {
      throw new Error(`Accepted attachment path is a symbolic link: ${item.name}`);
    }
    if (fs.existsSync(stagedPath) && fs.statSync(stagedPath).isFile()) {
      assertAcceptedAttachmentBytes(stagedPath, item);
      continue;
    }
    const sourcePath = path.resolve(item.sourcePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Attachment not found: ${item.name}`);
    }
    const sourceSize = fs.statSync(sourcePath).size;
    assertAcceptedAttachmentSize(sourceSize, item);
    const bytes = readExactlyBounded(sourcePath, sourceSize, item.name);
    assertAcceptedAttachmentBuffer(bytes, item);
    assertSafeAttachmentsDir(primaryRoot, destDir);
    const tempPath = path.join(
      path.dirname(stagedPath),
      `.${path.basename(stagedPath)}.${randomUUID()}.tmp`,
    );
    try {
      fs.writeFileSync(tempPath, bytes, { flag: "wx" });
      fs.linkSync(tempPath, stagedPath);
    } catch (error) {
      if (!fs.existsSync(stagedPath) || !fs.statSync(stagedPath).isFile()) {
        throw error;
      }
      assertAcceptedAttachmentBytes(stagedPath, item);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }
  writeAttachmentsManifest(primaryRoot, items);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertAcceptedAttachmentBytes(
  filePath: string,
  item: TaskAttachment,
): void {
  if (fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Accepted attachment path is a symbolic link: ${item.name}`);
  }
  const size = fs.statSync(filePath).size;
  assertAcceptedAttachmentSize(size, item);
  assertAcceptedAttachmentBuffer(
    readExactlyBounded(filePath, size, item.name),
    item,
  );
}

function assertAcceptedAttachmentBuffer(
  bytes: Uint8Array,
  item: TaskAttachment,
): void {
  assertAcceptedAttachmentSize(bytes.byteLength, item);
  if (item.contentSha256 && sha256(bytes) !== item.contentSha256) {
    throw new Error(`Attachment changed after acceptance: ${item.name}`);
  }
}

function assertAcceptedAttachmentSize(
  size: number,
  item: TaskAttachment,
): void {
  if (
    !isAllowedAttachmentSize(item.kind, size) ||
    (item.sizeBytes != null && size !== item.sizeBytes)
  ) {
    throw new Error(`Attachment changed after acceptance: ${item.name}`);
  }
}

/** Read no more than the already-validated stat size, detecting growth/shrink. */
function readExactlyBounded(
  filePath: string,
  expectedSize: number,
  name: string,
): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const currentSize = fs.fstatSync(fd).size;
    if (currentSize !== expectedSize) {
      throw new Error(`Attachment changed while reading: ${name}`);
    }
    const bytes = Buffer.allocUnsafe(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const read = fs.readSync(
        fd,
        bytes,
        offset,
        expectedSize - offset,
        offset,
      );
      if (read === 0) {
        throw new Error(`Attachment changed while reading: ${name}`);
      }
      offset += read;
    }
    const extra = Buffer.allocUnsafe(1);
    if (fs.readSync(fd, extra, 0, 1, expectedSize) !== 0) {
      throw new Error(`Attachment changed while reading: ${name}`);
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function prepareSafeAttachmentsDir(primaryRoot: string): string {
  const primary = path.resolve(primaryRoot);
  if (!fs.existsSync(primary) || !fs.statSync(primary).isDirectory()) {
    throw new Error("Attachment workspace is unavailable");
  }
  if (fs.lstatSync(primary).isSymbolicLink()) {
    throw new Error("Attachment workspace cannot be a symbolic link");
  }
  const destDir = path.join(primary, ATTACHMENTS_DIR);
  if (fs.existsSync(destDir) && fs.lstatSync(destDir).isSymbolicLink()) {
    throw new Error("Attachment directory cannot be a symbolic link");
  }
  fs.mkdirSync(destDir, { recursive: true });
  assertSafeAttachmentsDir(primary, destDir);
  return destDir;
}

function assertSafeAttachmentsDir(
  primaryRoot: string,
  destDir: string,
): void {
  const primary = path.resolve(primaryRoot);
  if (fs.lstatSync(primary).isSymbolicLink()) {
    throw new Error("Attachment workspace cannot be a symbolic link");
  }
  if (fs.lstatSync(destDir).isSymbolicLink()) {
    throw new Error("Attachment directory cannot be a symbolic link");
  }
  const primaryReal = fs.realpathSync(primary);
  const destReal = fs.realpathSync(destDir);
  if (!isPathInside(destReal, primaryReal)) {
    throw new Error("Attachment directory escapes workspace");
  }
}

function isPathInside(candidate: string, parent: string): boolean {
  // Shared helper is Windows drive-letter case aware.
  return isPathInsideRoot(candidate, parent);
}

/** Merge new staged items into any existing turn manifests for this workspace. */
export function writeAttachmentsManifest(
  primaryRoot: string,
  items: TaskAttachment[],
): void {
  if (items.length === 0) return;
  const destDir = prepareSafeAttachmentsDir(primaryRoot);
  const manifestFile = path.join(destDir, ATTACHMENTS_MANIFEST);
  if (
    fs.existsSync(manifestFile) &&
    fs.lstatSync(manifestFile).isSymbolicLink()
  ) {
    throw new Error("Attachment manifest cannot be a symbolic link");
  }
  const prior = readManifestArray(manifestFile);
  const seen = new Set(prior.map((p) => p.stagedPath || p.sourcePath));
  const merged = [...prior];
  for (const item of items) {
    const key = item.stagedPath || item.sourcePath;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: item.id,
      name: item.name,
      sourcePath: item.sourcePath,
      kind: item.kind,
      stagedPath: item.stagedPath,
    });
  }
  // Keep the newest entries if history grew past the soft cap.
  const capped =
    merged.length > MAX_MANIFEST_ENTRIES
      ? merged.slice(merged.length - MAX_MANIFEST_ENTRIES)
      : merged;
  fs.writeFileSync(manifestFile, JSON.stringify(capped, null, 2), "utf8");
}

/** Load attachment prompt block for engine preamble (empty if none). */
export function loadAttachmentsPreamble(primaryRoot: string): string {
  const manifestFile = attachmentsManifestPath(primaryRoot);
  const entries = readManifestArray(manifestFile);
  if (entries.length === 0) return "";
  return buildAttachmentsPromptBlock(entries);
}
