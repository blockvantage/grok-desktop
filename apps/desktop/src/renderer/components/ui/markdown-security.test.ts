import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const markdownSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "markdown.tsx"),
  "utf8",
);

describe("markdown security guards (source)", () => {
  it("sanitizes link hrefs to http(s) and fragments only", () => {
    expect(markdownSrc).toMatch(/sanitizeMarkdownHref/);
    expect(markdownSrc).toMatch(/p !== "http:" && p !== "https:"/);
    expect(markdownSrc).toMatch(/u\.username \|\| u\.password/);
    expect(markdownSrc).toMatch(/onOpenUrl/);
    expect(markdownSrc).toMatch(/event\.preventDefault\(\)/);
  });

  it("blocks remote http(s) images by default", () => {
    expect(markdownSrc).toMatch(/md-remote-img-blocked/);
    expect(markdownSrc).toMatch(/https\?:/);
  });

  it("only renders disabled task-list checkboxes, never free-form inputs", () => {
    expect(markdownSrc).toMatch(/type === "checkbox"/);
    expect(markdownSrc).toMatch(/readOnly/);
    // Non-checkbox branch must not render a live <input>
    expect(markdownSrc).toMatch(/: null/);
    expect(markdownSrc).not.toMatch(
      /type === "checkbox" \?[\s\S]*: \(\s*<input \{\.\.\.props\} \/>/,
    );
  });
});
