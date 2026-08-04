/**
 * Pure helpers for workspace file preview / deliverable display (Phase 6 extract
 * from task-workspace-view).
 */

export function fileName(p: string | null | undefined): string {
  if (!p) return "file";
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(name);
}

/** A fence longer than any backtick run inside the content, so code never breaks out. */
export function safeFence(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  css: "css",
  scss: "scss",
  xml: "xml",
  diff: "diff",
};

export function extLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? ext;
}

/** Wrap non-markdown content for Markdown renderer as a fenced code block. */
export function previewBodyAsMarkdown(
  name: string,
  content: string,
): string {
  if (isMarkdownName(name)) return content;
  const fence = safeFence(content);
  return `${fence}${extLang(name)}\n${content}\n${fence}`;
}
