// @vitest-environment jsdom
import DOMPurify from "dompurify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { sanitizeMermaidSvg } from "./mermaid-block";

const HOSTILE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
  "<script>window.pwned = true;</script>",
  '<foreignObject><iframe src="https://evil.example"></iframe></foreignObject>',
  '<rect width="10" height="10" onclick="alert(2)"></rect>',
  "<text>node label</text>",
  "</svg>",
].join("");

describe("sanitizeMermaidSvg", () => {
  it("strips script elements and their contents", () => {
    const clean = sanitizeMermaidSvg(HOSTILE_SVG);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("pwned");
  });

  it("strips on* event handler attributes", () => {
    const clean = sanitizeMermaidSvg(HOSTILE_SVG);
    expect(clean).not.toMatch(/\bon\w+\s*=/i);
  });

  it("strips foreignObject and its embedded HTML", () => {
    const clean = sanitizeMermaidSvg(HOSTILE_SVG);
    expect(clean.toLowerCase()).not.toContain("foreignobject");
    expect(clean).not.toContain("iframe");
  });

  it("keeps benign SVG shapes and labels", () => {
    const clean = sanitizeMermaidSvg(HOSTILE_SVG);
    expect(clean).toContain("<svg");
    expect(clean).toContain("<rect");
    expect(clean).toContain("node label");
  });

  it("explicitly forbids foreignObject in the DOMPurify config", () => {
    // Stubbed so DOMPurify cannot normalize the config before we inspect it.
    const sanitize = vi
      .spyOn(DOMPurify, "sanitize")
      .mockImplementation((dirty) => String(dirty));
    sanitizeMermaidSvg("<svg></svg>");
    const config = sanitize.mock.calls[0]?.[1];
    expect(config?.USE_PROFILES).toEqual({ svg: true, svgFilters: true });
    expect(config?.FORBID_TAGS).toEqual(["foreignObject"]);
    sanitize.mockRestore();
  });

  it("chrome copy goes through i18n catalogs", () => {
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "mermaid-block.tsx"),
      "utf8",
    );
    expect(src).toMatch(/t\("mermaid\.title"\)/);
    expect(src).toMatch(/t\("mermaid\.viewSource"\)/);
    expect(src).toMatch(/t\("mermaid\.viewDiagram"\)/);
    expect(src).toMatch(/t\("mermaid\.rendering"\)/);
    expect(src).not.toMatch(/>Mermaid</);
    expect(src).not.toMatch(/>View source</);
    expect(src).not.toMatch(/>Rendering…</);
  });
});
