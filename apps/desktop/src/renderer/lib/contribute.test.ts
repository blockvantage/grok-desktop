import { describe, expect, it, vi } from "vitest";
import {
  CONTRIBUTE_URLS,
  listContributeActions,
  openContributeUrl,
} from "./contribute";

describe("contribute helpers", () => {
  it("lists feature request and support; omits github when null", () => {
    const actions = listContributeActions({
      support: "https://grokdesk.app/support",
      featureRequest: "https://grokdesk.app/feedback",
      github: null,
    });
    expect(actions.map((a) => a.id)).toEqual(["featureRequest", "support"]);
  });

  it("includes github when set", () => {
    const actions = listContributeActions({
      support: "https://example.com/s",
      featureRequest: "https://example.com/f",
      github: "https://github.com/acme/desk",
    });
    expect(actions.map((a) => a.id)).toEqual([
      "featureRequest",
      "support",
      "github",
    ]);
  });

  it("drops blank urls", () => {
    expect(
      listContributeActions({
        support: "  ",
        featureRequest: "https://ok.example/f",
        github: "  ",
      }).map((a) => a.id),
    ).toEqual(["featureRequest"]);
  });

  it("opens https urls with noopener", () => {
    const open = vi.fn();
    openContributeUrl("https://grokdesk.app/support", open as typeof window.open);
    expect(open).toHaveBeenCalledWith(
      "https://grokdesk.app/support",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("ignores empty open targets", () => {
    const open = vi.fn();
    openContributeUrl("  ", open as typeof window.open);
    expect(open).not.toHaveBeenCalled();
  });

  it("ships default grokdesk.app support + feedback urls aligned with landing", () => {
    expect(CONTRIBUTE_URLS.support).toBe("https://grokdesk.app/support#give");
    expect(CONTRIBUTE_URLS.featureRequest).toBe(
      "https://grokdesk.app/feedback",
    );
    expect(CONTRIBUTE_URLS.github).toMatch(
      /github\.com\/blockvantage\/grok-desktop/,
    );
  });
});

