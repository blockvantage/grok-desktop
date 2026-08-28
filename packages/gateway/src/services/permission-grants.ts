/**
 * Persist Desk remembered grants in permission_grok-desk.toml (Phase 4.1 / A5).
 * Source of truth is gateway dataDir — isolated GROK_HOME copies are a spawn overlay.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  grantFileRelativePath,
  matchRememberedGrant,
  parsePermissionToml,
  serializePermissionToml,
  type GrantDecision,
  type GrantMatchInput,
  type RememberedGrant,
} from "@grokdesk/shared";

export class PermissionGrantStore {
  constructor(private rootDir: string) {}

  private fileFor(scopeRoot: string): string {
    return path.join(this.rootDir, grantFileRelativePath(scopeRoot));
  }

  list(scopeRoot: string): RememberedGrant[] {
    const file = this.fileFor(scopeRoot);
    try {
      const raw = fs.readFileSync(file, "utf8");
      return parsePermissionToml(raw, scopeRoot);
    } catch {
      return [];
    }
  }

  listAll(): RememberedGrant[] {
    const sessions = path.join(this.rootDir, "sessions");
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(sessions);
    } catch {
      return [];
    }
    const out: RememberedGrant[] = [];
    for (const dir of dirs) {
      const file = path.join(sessions, dir, "permission_grok-desk.toml");
      try {
        const raw = fs.readFileSync(file, "utf8");
        const scopeRoot = decodeURIComponent(dir);
        out.push(...parsePermissionToml(raw, scopeRoot));
      } catch {
        /* skip */
      }
    }
    return out;
  }

  upsert(input: {
    scopeRoot: string;
    toolPattern: string;
    decision: GrantDecision;
  }): RememberedGrant {
    const existing = this.list(input.scopeRoot).filter(
      (g) =>
        !(g.toolPattern === input.toolPattern && g.decision === input.decision),
    );
    const grant: RememberedGrant = {
      id: randomUUID(),
      scopeRoot: input.scopeRoot,
      toolPattern: input.toolPattern,
      decision: input.decision,
      createdAt: new Date().toISOString(),
    };
    this.write(input.scopeRoot, [...existing, grant]);
    return grant;
  }

  revoke(scopeRoot: string, toolPattern: string): boolean {
    const before = this.list(scopeRoot);
    const next = before.filter((g) => g.toolPattern !== toolPattern);
    if (next.length === before.length) return false;
    this.write(scopeRoot, next);
    return true;
  }

  match(scopeRoot: string, input: GrantMatchInput): RememberedGrant | null {
    return matchRememberedGrant(this.list(scopeRoot), input);
  }

  /** Overlay grants into an isolated GROK_HOME so this ACP spawn can see them. */
  copyIntoGrokHome(grokHome: string, scopeRoot: string): string | null {
    const grants = this.list(scopeRoot);
    if (grants.length === 0) return null;
    const dest = path.join(grokHome, grantFileRelativePath(scopeRoot));
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, serializePermissionToml(grants), { encoding: "utf8", mode: 0o600 });
    return dest;
  }

  private write(scopeRoot: string, grants: RememberedGrant[]): void {
    const file = this.fileFor(scopeRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (grants.length === 0) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* gone */
      }
      return;
    }
    fs.writeFileSync(file, serializePermissionToml(grants), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
