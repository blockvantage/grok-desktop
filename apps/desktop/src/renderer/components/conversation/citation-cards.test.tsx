import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CitationCards } from "./citation-cards";

describe("CitationCards", () => {
  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<CitationCards items={[]} />)).toBe("");
  });

  it("renders one safe external link per citation", () => {
    const html = renderToStaticMarkup(
      <CitationCards
        items={[
          {
            url: "https://www.example.com/study",
            title: "Example study",
            source: "web",
          },
          { url: "https://x.com/grok/status/1", title: "Grok post", source: "x" },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Sources"');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('href="https://www.example.com/study"');
    expect(html).toContain('href="https://x.com/grok/status/1"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noreferrer noopener"/g)).toHaveLength(2);
    expect(html).toContain("Example study");
    expect(html).toContain("example.com");
    expect(html).toContain("x.com");
    expect(html).not.toContain("data-citations-toggle");
  });

  it("uses the in-app browser contract when a link handler is provided", () => {
    const html = renderToStaticMarkup(
      <CitationCards
        items={[{ url: "https://example.com/source", title: "Source" }]}
        onOpenUrl={() => {}}
      />,
    );
    expect(html).toContain('href="https://example.com/source"');
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('rel="noreferrer noopener"');
  });

  it("falls back to the hostname for blank titles and keeps raw invalid URLs", () => {
    const html = renderToStaticMarkup(
      <CitationCards
        items={[
          { url: "https://www.docs.example.org/page", title: "  " },
          { url: "not a url" },
        ]}
      />,
    );
    expect(html).toContain(">docs.example.org<");
    expect(html).not.toContain(">www.docs.example.org<");
    expect(html).toContain("not a url");
  });

  it("collapses long lists to four cards plus an expand control", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      url: `https://example.com/${index}`,
    }));
    const html = renderToStaticMarkup(<CitationCards items={items} />);
    expect(html.match(/<a /g)).toHaveLength(4);
    expect(html).toContain("data-citations-toggle");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show all 6");
  });

  it("labels the expand control with the full citation count", () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `Source ${index}`,
    }));
    const html = renderToStaticMarkup(<CitationCards items={items} />);
    expect(html.match(/<a /g)).toHaveLength(4);
    expect(html).toContain("Show all 9");
  });
});
