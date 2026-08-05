import { isPathInsideAnyRoot } from "./paths.js";

export type SafeShellClassification =
  | { safe: true; reason: "read_only" | "verification" }
  | { safe: false; reason: string };

const READ_ONLY_COMMANDS = new Set(["cat", "head", "ls", "pwd", "rg", "tail", "wc"]);
const SAFE_GIT_SUBCOMMANDS = new Set([
  "branch",
  "diff",
  "log",
  "rev-parse",
  "show",
  "status",
]);
const SAFE_PACKAGE_SCRIPTS = new Set([
  "build",
  "check",
  "lint",
  "test",
  "typecheck",
  "verify",
]);

/**
 * Conservative allowlist for commands that Balanced mode can run without an
 * interruption. Anything ambiguous stays behind the normal approval card.
 */
export function classifyBalancedShellCommand(
  command: string,
  workspaceRoots: readonly string[] = [],
): SafeShellClassification {
  const value = command.trim();
  if (!value) return unsafe("empty command");
  if (value.length > 4_096) return unsafe("command is too long");
  if (/[\n\r;&|<>`$(){}]/.test(value)) {
    return unsafe("shell composition or expansion is not auto-approved");
  }

  const tokens = tokenizeCommand(value);
  if (!tokens || tokens.length === 0) return unsafe("command could not be classified");
  if (tokens.some((token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token))) {
    return unsafe("environment mutation is not auto-approved");
  }
  if (tokens.some(hasParentTraversal)) {
    return unsafe("parent path traversal is not auto-approved");
  }
  for (const token of tokens) {
    if (!isAbsolutePathToken(token)) continue;
    if (workspaceRoots.length === 0 || !isPathInsideAnyRoot(token, [...workspaceRoots])) {
      return unsafe("absolute path is outside the authorized workspace");
    }
  }

  const executable = tokens[0]?.toLowerCase();
  if (!executable) return unsafe("missing executable");

  if (executable === "pwd" && tokens.length === 1) {
    return { safe: true, reason: "read_only" };
  }
  if (READ_ONLY_COMMANDS.has(executable) && isSafeReadCommand(executable, tokens.slice(1))) {
    return { safe: true, reason: "read_only" };
  }
  if (executable === "git" && isSafeGitCommand(tokens.slice(1))) {
    return { safe: true, reason: "read_only" };
  }
  if (
    ["bun", "npm", "pnpm", "yarn"].includes(executable) &&
    isSafePackageVerification(tokens.slice(1))
  ) {
    return { safe: true, reason: "verification" };
  }

  return unsafe("command is not on the balanced-mode safe list");
}

function unsafe(reason: string): SafeShellClassification {
  return { safe: false, reason };
}

function tokenizeCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  const push = () => {
    if (!current) return;
    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < command.length) {
        current += command[index + 1]!;
        index += 1;
      } else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) push();
    else if (char === "\\" && index + 1 < command.length) {
      current += command[index + 1]!;
      index += 1;
    } else current += char;
  }
  if (quote) return null;
  push();
  return tokens;
}

function hasParentTraversal(token: string): boolean {
  return /(^|[\\/])\.\.([\\/]|$)/.test(token);
}

function isAbsolutePathToken(token: string): boolean {
  return token.startsWith("/") || /^[A-Za-z]:[\\/]/.test(token);
}

function isSafeReadCommand(executable: string, args: string[]): boolean {
  if (executable === "rg" && args.some((arg) => arg === "--pre" || arg.startsWith("--pre="))) {
    return false;
  }
  return !args.some((arg) =>
    ["--files-with-matches-from", "--output", "--replace"].some(
      (unsafeFlag) => arg === unsafeFlag || arg.startsWith(`${unsafeFlag}=`),
    ),
  );
}

function isSafeGitCommand(args: string[]): boolean {
  const subcommand = args[0]?.toLowerCase();
  if (!subcommand || !SAFE_GIT_SUBCOMMANDS.has(subcommand)) return false;
  if (
    args.some((arg) =>
      ["--exec", "--ext-diff", "--no-index", "--output"].some(
        (unsafeFlag) => arg === unsafeFlag || arg.startsWith(`${unsafeFlag}=`),
      ),
    )
  ) {
    return false;
  }
  if (subcommand === "branch") {
    return args.slice(1).every((arg) => arg.startsWith("-") || arg === "list");
  }
  return true;
}

function isSafePackageVerification(args: string[]): boolean {
  let index = 0;
  while (index < args.length && args[index]?.startsWith("-")) {
    const flag = args[index]!;
    if (["--filter", "--dir", "--prefix", "-C", "-F"].includes(flag)) index += 2;
    else index += 1;
  }
  if (args[index] === "run") index += 1;
  const script = args[index]?.toLowerCase();
  return script != null && SAFE_PACKAGE_SCRIPTS.has(script);
}
