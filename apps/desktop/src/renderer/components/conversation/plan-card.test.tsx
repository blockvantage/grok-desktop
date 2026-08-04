import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
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
});
