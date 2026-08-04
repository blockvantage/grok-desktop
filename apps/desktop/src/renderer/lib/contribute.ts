/**
 * In-app Support menu destinations (feedback, support hub, GitHub).
 * Leave `github` null to hide the repo link.
 */

export type ContributeUrls = {
  /** Pay-what-you-want / sponsor page */
  support: string;
  /** Feature request / feedback form or Discussions */
  featureRequest: string;
  /** Public GitHub repo (null hides the star item) */
  github: string | null;
};

export const CONTRIBUTE_URLS: ContributeUrls = {
  /** Landing support hub: PWYW Stripe checkout (#give) + contribute cards. */
  support: "https://grokdesk.app/support#give",
  featureRequest: "https://grokdesk.app/feedback",
  /** Baked free-release repo (blockvantage/grok-desktop — change here if it moves). */
  github: "https://github.com/blockvantage/grok-desktop",
};

/**
 * Open a contribute URL in the system browser via the renderer bridge
 * (main process enforces http/https only).
 */
export function openContributeUrl(
  url: string,
  open: typeof window.open = (...args) => window.open(...args),
): void {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return;
  open(trimmed, "_blank", "noopener,noreferrer");
}

/** Ordered menu actions currently enabled by URL config. */
export function listContributeActions(
  urls: ContributeUrls = CONTRIBUTE_URLS,
): Array<{ id: "featureRequest" | "support" | "github"; url: string }> {
  const out: Array<{
    id: "featureRequest" | "support" | "github";
    url: string;
  }> = [
    { id: "featureRequest", url: urls.featureRequest },
    { id: "support", url: urls.support },
  ];
  if (urls.github?.trim()) {
    out.push({ id: "github", url: urls.github.trim() });
  }
  return out.filter((a) => a.url.trim().length > 0);
}
