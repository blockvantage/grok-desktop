/**
 * Product feature flags for free Desk builds.
 *
 * Free Desk: no product-key wall. Remote control UI remains hidden by default.
 * Product licensing was retired (Phase 6); do not re-enable paid Desk gates.
 */

/** Free / open distribution — Desk product license is not required. */
export const GROKDESK_OPEN_SOURCE = true;

/**
 * Always false: Desk never requires a product key / GD3 activation.
 * Retained as a constant for any residual call sites; enforcement is removed.
 */
export const GROKDESK_PRODUCT_KEY_ENFORCEMENT = false;

/**
 * When false, Settings → Remote, tray remote items, and the remote-control
 * banner are not shown. Backend remote/relay code remains in the tree.
 */
export const GROKDESK_REMOTE_UI_ENABLED = false;
