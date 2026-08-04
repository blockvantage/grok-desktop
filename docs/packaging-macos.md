# macOS packaging & notarization

Code-only packaging is already wired via `electron-builder` (`apps/desktop/electron-builder.yml`). **Signing and notarization require Apple Developer credentials** you must supply locally or in CI secrets. This doc is a template only; no certs or passwords live in the repo.

## Qualified release targets

| Process target | Runner (CI) | Artifacts |
| --- | --- | --- |
| `darwin-arm64` | `macos-14` | DMG + ZIP (updater) |
| `darwin-x64` | `macos-13` | DMG + ZIP (updater) |

### Free public channel (grokdesk.app)

Workflow: `.github/workflows/release-free-github.yml`

- Free Desk: **no product key / Desk license**. Do **not** bake
  `GROKDESK_LICENSE_PUBLIC_KEY` for product-license verification (retired —
  see [license-release-keys.md](./license-release-keys.md)).
- Builds signed/notarized mac artifacts when Apple secrets are present; free
  public builds must never set `GROKDESK_BAKE_DEV_UNLOCK`.
- Optional update verification uses `GROKDESK_RELEASE_PUBLIC_KEYS` (release
  manifests), which is **not** Desk product licensing.

### Qualified / paid-channel workflow (historical matrix)

Workflow: `.github/workflows/release-desktop.yml`.
Gate: `pnpm exec tsx scripts/assert-release-targets.ts` (rejects unqualified matrices).

Real-machine evidence before stable manifest sign: copy
[qualification-template.md](./releases/qualification-template.md) per target.

Rollback / revoke: [bad-release-rollback.md](./runbooks/bad-release-rollback.md),
[artifact-revocation.md](./runbooks/artifact-revocation.md).

## Build unsigned / ad-hoc (dev)

```bash
pnpm --filter @grokdesk/desktop build
pnpm --filter @grokdesk/desktop exec electron-builder --mac --arm64 --dir
```

## Signed + notarized release (env flow)

electron-builder uses these environment variables when set:

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Path or base64 of `.p12` Developer ID Application certificate |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character Team ID |

Example (do **not** commit real values):

```bash
export CSC_LINK="/secure/path/DeveloperID.p12"
export CSC_KEY_PASSWORD="…"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

pnpm --filter @grokdesk/desktop build
pnpm --filter @grokdesk/desktop exec electron-builder --mac --arm64
```

## Icon cache (stale Dock / Finder icon)

After replacing `apps/desktop/build/icon.icns` or app icons:

```bash
# Quit the app, then:
sudo rm -rf /Library/Caches/com.apple.iconservices.store
killall Dock Finder
```

## Product licensing (retired)

Grok Desk is **free**. Product-key verification is not part of the free app path.
Do **not** require or document baking `GROKDESK_LICENSE_PUBLIC_KEY` so main can
“verify licenses” for free or public builds. Historical notes:
[license-release-keys.md](./license-release-keys.md).

Optional **update / runtime** signature verification uses
`GROKDESK_RELEASE_PUBLIC_KEYS` at build time when update signing is configured.
That key ring is separate from retired Desk product licensing. Never commit
private signing keys.

## Release checklist (macOS)

### Free public builds (`release-free-github.yml`)

1. Typecheck / unit / package smoke green; refuse entitlement unlock bake envs
2. Signed DMG + ZIP when CSC/Apple secrets present; `codesign --verify --deep --strict`
3. Notarization + staple when Apple notarization secrets present
4. Free app launches without a Desk product key; no license activation UX
5. Do **not** import SHA-256 catalogs into a Desk product-license entitlement service

### Qualified matrix (optional; `release-desktop.yml`)

1. Typecheck / unit / contract / package smoke green on the gate job
2. Signed DMG + ZIP; `codesign --verify --deep --strict`
3. Notarization + staple (`spctl --assess`, `xcrun stapler validate`)
4. SHA-256 catalog for **update/runtime** release artifacts only (not product keys)
5. Qualification template filled on **real** Apple silicon and Intel hardware
6. Dual approval before stable **update** manifest sign (manifest private key stays in KMS)
