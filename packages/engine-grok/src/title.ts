import { spawn } from "node:child_process";
import os from "node:os";
import { cliCommand, resolveManagedGrokBinary } from "./discover.js";

export interface GenerateTitleOptions {
  binary?: string | null;
  model?: string;
  timeoutMs?: number;
}

const TITLE_SCHEMA = JSON.stringify({
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
});

/**
 * Ask Grok for a short chat title in a single, tool-less, non-interactive call.
 *
 * Uses `--json-schema` (implies `--output-format json`) to constrain the model
 * to `{ "title": "..." }`, and disables tools/subagents/plan/memory/web so it's
 * a pure one-shot completion. Returns null on any failure — callers fall back
 * to a trimmed goal, so this must never throw.
 */
export async function generateGrokTitle(
  goal: string,
  opts: GenerateTitleOptions = {},
): Promise<string | null> {
  // Keep tests hermetic: never spawn the real CLI under vitest.
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return null;
  }
  const clean = goal.trim();
  if (!clean) return null;

  const binary =
    opts.binary ?? (await resolveManagedGrokBinary({ env: process.env }));
  if (!binary) return null;

  const prompt =
    "Write a short, specific title (3 to 6 words, Title Case, no quotes, " +
    "no trailing punctuation) that names this task for a sidebar. " +
    "Reply with only the title.\n\nTask: " +
    clean.slice(0, 2000);

  const args = [
    "-p",
    prompt,
    "--json-schema",
    TITLE_SCHEMA,
    "--max-turns",
    "1",
    "--no-subagents",
    "--no-plan",
    "--no-memory",
    "--disable-web-search",
    "--cwd",
    os.tmpdir(),
  ];
  if (opts.model) args.push("-m", opts.model);

  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise<string | null>((resolve) => {
    let out = "";
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };

    let child: ReturnType<typeof spawn>;
    try {
      const { command, args: spawnArgs } = cliCommand(binary, args);
      child = spawn(command, spawnArgs, {
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      done(null);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      done(null);
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.on("error", () => done(null));
    child.on("close", () => done(cleanTitle(extractTitle(out)) || null));
  });
}

/** Pull the title out of the CLI's JSON envelope (structuredOutput or text). */
function extractTitle(stdout: string): string {
  const raw = stdout.trim();
  if (!raw) return "";
  try {
    const env = JSON.parse(raw) as {
      structuredOutput?: { title?: unknown };
      text?: unknown;
    };
    if (env.structuredOutput && typeof env.structuredOutput.title === "string") {
      return env.structuredOutput.title;
    }
    if (typeof env.text === "string") {
      // `text` may itself be JSON like {"title":"..."}.
      const t = env.text.trim();
      if (t.startsWith("{")) {
        try {
          const inner = JSON.parse(t) as { title?: unknown };
          if (typeof inner.title === "string") return inner.title;
        } catch {
          // fall through
        }
      }
      return env.text;
    }
  } catch {
    // Not JSON — treat whole stdout as the candidate.
    return raw;
  }
  return "";
}

/** Normalize to a clean one-line title, or empty string if unusable. */
function cleanTitle(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim()
    .slice(0, 80);
}
