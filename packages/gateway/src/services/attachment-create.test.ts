import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stageAttachmentsForCreate } from "./attachment-create.js";
import { finalizeTaskAttachments } from "./attachment-stage.js";
import { MAX_IMAGE_BYTES, type TaskAttachment } from "@grokdesk/shared";

const att = (name: string): TaskAttachment => ({
  id: "a1",
  kind: "file",
  name,
  sourcePath: `/src/${name}`,
  mimeType: "text/plain",
  sizeBytes: 1,
});

describe("stageAttachmentsForCreate", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-ops when no primary or empty attachments", () => {
    expect(
      stageAttachmentsForCreate({
        primaryRoot: undefined,
        attachments: [att("x")],
        parentTaskId: null,
        dataDir: "/data",
      }),
    ).toEqual({ ok: true, attachments: undefined });
    expect(
      stageAttachmentsForCreate({
        primaryRoot: "/data/workspaces/c1",
        attachments: [],
        parentTaskId: null,
        dataDir: "/data",
      }),
    ).toEqual({ ok: true, attachments: undefined });
  });

  it("returns staged attachments on success", () => {
    const staged = [att("ok.txt")];
    const r = stageAttachmentsForCreate({
      primaryRoot: "/data/workspaces/c1",
      attachments: [att("in.txt")],
      parentTaskId: null,
      dataDir: "/data",
      stage: () => staged,
    });
    expect(r).toEqual({ ok: true, attachments: staged });
  });

  it("plans image destinations without writing workspace artifacts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-plan-"));
    tempDirs.push(dir);
    const workspace = path.join(dir, "workspace");
    const sourcePath = path.join(dir, "photo.png");
    fs.mkdirSync(workspace);
    fs.writeFileSync(sourcePath, "image-bytes");

    const result = stageAttachmentsForCreate({
      primaryRoot: workspace,
      attachments: [
        {
          id: "photo-id",
          kind: "image",
          name: "photo.png",
          sourcePath,
          sizeBytes: 11,
        },
      ],
      parentTaskId: "parent",
      dataDir: dir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const planned = result.attachments?.[0];
    expect(planned?.stagedPath).toContain(path.join(workspace, "attachments"));
    expect(planned?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(planned!.stagedPath!)).toBe(false);
    expect(fs.existsSync(path.join(workspace, "attachments", "manifest.json"))).toBe(false);
  });

  it("refuses to finalize bytes that changed after acceptance planning", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-digest-"));
    tempDirs.push(dir);
    const workspace = path.join(dir, "workspace");
    const sourcePath = path.join(dir, "photo.png");
    fs.mkdirSync(workspace);
    fs.writeFileSync(sourcePath, "accepted-bytes");
    const result = stageAttachmentsForCreate({
      primaryRoot: workspace,
      attachments: [
        {
          id: "photo-id",
          kind: "image",
          name: "photo.png",
          sourcePath,
          sizeBytes: 14,
        },
      ],
      parentTaskId: "parent",
      dataDir: dir,
    });
    if (!result.ok || !result.attachments) throw new Error("plan failed");
    fs.writeFileSync(sourcePath, "changed-after-acceptance");

    expect(() =>
      finalizeTaskAttachments(workspace, result.attachments!),
    ).toThrow("changed after acceptance");
    expect(fs.existsSync(result.attachments[0]!.stagedPath!)).toBe(false);
  });

  it("rejects an oversized source before reading its contents", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-oversize-plan-"));
    tempDirs.push(dir);
    const workspace = path.join(dir, "workspace");
    const sourcePath = path.join(dir, "huge.png");
    fs.mkdirSync(workspace);
    fs.closeSync(fs.openSync(sourcePath, "w"));
    fs.truncateSync(sourcePath, MAX_IMAGE_BYTES + 1);
    const readSync = vi.spyOn(fs, "readSync");

    const result = stageAttachmentsForCreate({
      primaryRoot: workspace,
      attachments: [{
        id: "huge",
        kind: "image",
        name: "huge.png",
        sourcePath,
      }],
      parentTaskId: "parent",
      dataDir: dir,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(String(result.error)).toContain("too large");
    expect(readSync).not.toHaveBeenCalled();
    readSync.mockRestore();
  });

  it("rejects a source that grew after acceptance before reading it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-oversize-finalize-"));
    tempDirs.push(dir);
    const workspace = path.join(dir, "workspace");
    const sourcePath = path.join(dir, "photo.png");
    fs.mkdirSync(workspace);
    fs.writeFileSync(sourcePath, "accepted");
    const result = stageAttachmentsForCreate({
      primaryRoot: workspace,
      attachments: [{
        id: "photo",
        kind: "image",
        name: "photo.png",
        sourcePath,
      }],
      parentTaskId: "parent",
      dataDir: dir,
    });
    if (!result.ok || !result.attachments) throw new Error("plan failed");
    fs.truncateSync(sourcePath, MAX_IMAGE_BYTES + 1);
    const readSync = vi.spyOn(fs, "readSync");

    expect(() => finalizeTaskAttachments(workspace, result.attachments!))
      .toThrow("changed after acceptance");
    expect(readSync).not.toHaveBeenCalled();
    readSync.mockRestore();
  });

  it("rejects a symlinked attachments directory without writing outside the workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-symlink-"));
    tempDirs.push(dir);
    const workspace = path.join(dir, "workspace");
    const outside = path.join(dir, "outside");
    const sourcePath = path.join(dir, "photo.png");
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.writeFileSync(sourcePath, "image-bytes");
    fs.symlinkSync(outside, path.join(workspace, "attachments"), "dir");
    const result = stageAttachmentsForCreate({
      primaryRoot: workspace,
      attachments: [{
        id: "photo",
        kind: "image",
        name: "photo.png",
        sourcePath,
      }],
      parentTaskId: "parent",
      dataDir: dir,
    });
    if (!result.ok || !result.attachments) throw new Error("plan failed");

    expect(() => finalizeTaskAttachments(workspace, result.attachments!))
      .toThrow("symbolic link");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("cleans orphan managed workspace on stage failure for new chat", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-clean-"));
    tempDirs.push(dataDir);
    const primary = path.join(dataDir, "workspaces", "grok-chat-ABC123");
    fs.mkdirSync(primary, { recursive: true });
    const r = stageAttachmentsForCreate({
      primaryRoot: primary,
      attachments: [att("bad.png")],
      parentTaskId: null,
      dataDir,
      stage: () => {
        throw new Error("not found");
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.cleanedOrphan).toBe(true);
    expect(fs.existsSync(primary)).toBe(false);
  });

  it("does not delete workspace for follow-up (parent set)", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-followup-"));
    tempDirs.push(dataDir);
    const primary = path.join(dataDir, "workspaces", "grok-chat-ABC123");
    fs.mkdirSync(primary, { recursive: true });
    const r = stageAttachmentsForCreate({
      primaryRoot: primary,
      attachments: [att("bad.png")],
      parentTaskId: "parent-1",
      dataDir,
      stage: () => {
        throw new Error("boom");
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.cleanedOrphan).toBe(false);
    expect(fs.existsSync(primary)).toBe(true);
  });

  it("does not delete user project roots", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-attachment-user-root-"));
    tempDirs.push(dataDir);
    const primary = path.join(dataDir, "project");
    fs.mkdirSync(primary);
    const r = stageAttachmentsForCreate({
      primaryRoot: primary,
      attachments: [att("bad.png")],
      parentTaskId: null,
      dataDir,
      stage: () => {
        throw new Error("boom");
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.cleanedOrphan).toBe(false);
    expect(fs.existsSync(primary)).toBe(true);
  });
});
