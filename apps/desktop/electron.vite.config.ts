import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = resolve(__dirname, "../..");

/**
 * Free Desk: product licensing is retired. GROKDESK_LICENSE_PUBLIC_KEY may still
 * be set for residual non-gating crypto paths; empty is normal and does not
 * block free-app admission or task create.
 */
const licensePublicKey = process.env.GROKDESK_LICENSE_PUBLIC_KEY?.trim() ?? "";

/**
 * Release-manifest public key ring (JSON JWK array with kid) for app/runtime
 * update signature verification. Empty = update signatures do not verify
 * (updates fail closed); this is not a Desk product-license gate.
 */
const releasePublicKeys = process.env.GROKDESK_RELEASE_PUBLIC_KEYS?.trim() ?? "";

/**
 * Legacy device-lease JWKS bake (optional residual). Free Desk ignores product
 * device-lease fail-closed at runtime; values are harmless when unset.
 */
const leasePublicKeys =
  process.env.GROKDESK_LEASE_PUBLIC_KEYS?.trim() ||
  process.env.GROKDESK_LEASE_PUBLIC_JWKS?.trim() ||
  "";

/**
 * Optional update/service base URLs for free builds (manifest / historical
 * entitlement host used for release downloads). Empty is allowed; free Desk
 * does not require Desk product entitlement API state to run.
 */
const entitlementApiUrl =
  process.env.GROKDESK_ENTITLEMENT_API_URL?.trim() ?? "";
const manifestUrl = process.env.GROKDESK_MANIFEST_URL?.trim() ?? "";

/**
 * Optional compile-time bake for local CLI discovery helpers in review installers
 * (`GROKDESK_BAKE_DEV_UNLOCK=1`). Free Desk already admits without a product key;
 * this flag is not a product-license bypass.
 *
 * CRITICAL: do NOT bake from runtime GROKDESK_DEV_UNLOCK (common in dev shells).
 * Production free-release CI must not set GROKDESK_BAKE_DEV_UNLOCK.
 */
const bakeDevUnlock = process.env.GROKDESK_BAKE_DEV_UNLOCK === "1";

/**
 * Main process no longer loads gateway/sqlite in-process — it spawns a Node
 * child. Renderer still aliases shared types if needed.
 */
/**
 * Workspace packages are pure ESM (`exports.import` only). Electron main is
 * packaged as CJS and `require()` fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Bundle @grokdesk/* into main instead of externalizing them.
 */
const bundleWorkspacePackages = externalizeDepsPlugin({
  exclude: [
    "@grokdesk/engine-grok",
    "@grokdesk/shared",
    "@grokdesk/gateway",
    "@grokdesk/license",
    "@grokdesk/entitlement-client",
  ],
});

export default defineConfig({
  main: {
    plugins: [bundleWorkspacePackages],
    define: {
      __GROKDESK_LICENSE_PUBLIC_KEY__: JSON.stringify(licensePublicKey),
      __GROKDESK_RELEASE_PUBLIC_KEYS__: JSON.stringify(releasePublicKeys),
      __GROKDESK_LEASE_PUBLIC_KEYS__: JSON.stringify(leasePublicKeys),
      __GROKDESK_ENTITLEMENT_API_URL__: JSON.stringify(entitlementApiUrl),
      __GROKDESK_MANIFEST_URL__: JSON.stringify(manifestUrl),
      __GROKDESK_DEV_UNLOCK__: JSON.stringify(bakeDevUnlock),
    },
    resolve: {
      alias: [
        // More specific subpath first — do not map /node onto index.js
        {
          find: "@grokdesk/shared/node",
          replacement: resolve(workspaceRoot, "packages/shared/dist/node.js"),
        },
        {
          find: "@grokdesk/shared",
          replacement: resolve(workspaceRoot, "packages/shared/dist/index.js"),
        },
        {
          find: "@grokdesk/engine-grok",
          replacement: resolve(
            workspaceRoot,
            "packages/engine-grok/dist/index.js",
          ),
        },
        {
          find: "@grokdesk/license",
          replacement: resolve(workspaceRoot, "packages/license/dist/index.js"),
        },
        {
          find: "@grokdesk/entitlement-client",
          replacement: resolve(
            workspaceRoot,
            "packages/entitlement-client/dist/index.js",
          ),
        },
      ],
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [bundleWorkspacePackages],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    // Relative base is required for file:// packaged loads (absolute /assets break).
    base: "./",
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
        "@grokdesk/shared": resolve(workspaceRoot, "packages/shared/dist/index.js"),
      },
    },
    css: {
      postcss: resolve(__dirname, "postcss.config.js"),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
      },
    },
    plugins: [react()],
  },
});
