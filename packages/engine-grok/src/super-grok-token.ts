/**
 * Read SuperGrok access token for main-process HTTP only.
 * NEVER log, return to renderer, or include in gateway RPC results.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface AuthJsonEntry {
  email?: string;
  first_name?: string;
  last_name?: string;
  expires_at?: string;
  key?: string;
  access_token?: string;
  refresh_token?: string;
  user_id?: string;
}

export interface SuperGrokTokenResult {
  accessToken: string;
  signedIn: boolean;
  hasRefreshToken: boolean;
}

function pickEntry(entries: AuthJsonEntry[]): AuthJsonEntry | null {
  if (entries.length === 0) return null;
  const ranked = [...entries].sort((a, b) => {
    const score = (e: AuthJsonEntry) =>
      (e.refresh_token ? 4 : 0) +
      (e.key || e.access_token ? 2 : 0) +
      (e.email ? 1 : 0);
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

/**
 * Returns access token from ~/.grok/auth.json or null if unavailable.
 * Does not refresh; caller may re-probe after CLI refresh.
 */
export async function readSuperGrokAccessToken(
  home: string = os.homedir(),
): Promise<SuperGrokTokenResult | null> {
  const authPath = path.join(home, ".grok", "auth.json");
  try {
    const raw = await fs.readFile(authPath, "utf8");
    const data = JSON.parse(raw) as Record<string, AuthJsonEntry>;
    const entries = Object.values(data).filter(
      (e) => e && typeof e === "object",
    );
    const first = pickEntry(entries);
    if (!first) return null;

    const accessToken = String(first.key || first.access_token || "").trim();
    const hasRefreshToken = Boolean(
      first.refresh_token && String(first.refresh_token).length > 0,
    );
    if (!accessToken && !hasRefreshToken) return null;
    if (!accessToken) {
      return { accessToken: "", signedIn: hasRefreshToken, hasRefreshToken };
    }
    return {
      accessToken,
      signedIn: true,
      hasRefreshToken,
    };
  } catch {
    return null;
  }
}
