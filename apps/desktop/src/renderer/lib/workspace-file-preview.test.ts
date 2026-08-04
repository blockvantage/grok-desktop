import { describe, it, expect } from "vitest";
import {
  extLang,
  fileName,
  isMarkdownName,
  pathKey,
  previewBodyAsMarkdown,
  safeFence,
} from "./workspace-file-preview";

describe("fileName / pathKey", () => {
  it("extracts basename for posix and windows paths", () => {
    expect(fileName("/a/b/c.txt")).toBe("c.txt");
    expect(fileName("C:\\a\\b\\c.txt")).toBe("c.txt");
    expect(fileName(null)).toBe("file");
  });

  it("normalizes path keys", () => {
    expect(pathKey("C:\\Foo\\Bar")).toBe("c:/foo/bar");
  });
});

describe("markdown detection and fencing", () => {
  it("detects markdown extensions", () => {
    expect(isMarkdownName("a.md")).toBe(true);
    expect(isMarkdownName("a.MDX")).toBe(true);
    expect(isMarkdownName("a.ts")).toBe(false);
  });

  it("safeFence grows past nested backticks", () => {
    expect(safeFence("plain")).toBe("```");
    expect(safeFence("has ``` inside")).toBe("````");
  });

  it("extLang maps common languages", () => {
    expect(extLang("x.ts")).toBe("typescript");
    expect(extLang("x.py")).toBe("python");
    expect(extLang("x.unknownext")).toBe("unknownext");
  });

  it("previewBodyAsMarkdown fences non-markdown", () => {
    const out = previewBodyAsMarkdown("a.ts", "const x = 1;");
    expect(out).toContain("```typescript");
    expect(out).toContain("const x = 1;");
    expect(previewBodyAsMarkdown("a.md", "# Hi")).toBe("# Hi");
  });
});
