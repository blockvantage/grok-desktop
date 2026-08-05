import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { PlanCard } from "./plan-card";

describe("PlanCard", () => {
  it("renders plan content and action buttons when awaiting approval", () => {
    const html = renderToStaticMarkup(
      <PlanCard
        plan={{ content: "# Plan\n- step", status: "awaiting_approval" }}
        busy={false}
        onApprove={() => {}}
        onRequestChanges={() => {}}
        onRunAnyway={() => {}}
      />,
    );
    expect(html).toContain("Plan ready for review");
    expect(html).toMatch(/Approve &amp; start|Approve & start/);
    expect(html).toContain("Request changes");
    expect(html).toContain("Run without plan");
    expect(html).toMatch(/role="region"/);
    expect(html).toMatch(/data-approval-focus-target/);
    expect(html).toMatch(/role="group"/);
    expect(html).toMatch(/data-approval-actions/);
  });

  it("hides actions while drafting", () => {
    const html = renderToStaticMarkup(
      <PlanCard
        plan={{ content: "…", status: "drafting" }}
        onApprove={() => {}}
        onRequestChanges={() => {}}
        onRunAnyway={() => {}}
      />,
    );
    expect(html).toContain("Drafting a plan");
    expect(html).not.toMatch(/Approve/);
  });

  it("routes plan Markdown links through the conversation URL handler", () => {
    const source = fs.readFileSync(new URL("./plan-card.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/onOpenUrl\?:\s*\(url:\s*string\)/);
    expect(source).toMatch(/<Markdown[^>]*onOpenUrl=\{onOpenUrl\}/s);
  });
});
