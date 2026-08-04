# Windows packaging & Authenticode

Windows installers are produced with electron-builder (NSIS). **Authenticode signing requires a code-signing certificate** you purchase and store securely. This doc is a template only.

## Install pipeline (end-to-end)

```
grokdesk.app Download for Windows
  → https://github.com/blockvantage/grok-desktop/releases/latest/download/GrokDesk-win-x64.exe
  → NSIS one-click per-user install (%LOCALAPPDATA%\Programs\Grok Desk)
  → Grok Desk.exe launches (open-source: no product-key wall)
```

| Stage | What can fail | Mitigation |
| --- | --- | --- |
| Download | 404 / wrong asset name | Free CI stages stable `GrokDesk-win-x64.exe` via `scripts/stage-free-release-assets.mjs` |
| SmartScreen | **Unsigned NSIS blocked** (“Windows protected your PC”) | Ship with `WIN_CSC_*` Authenticode secrets; site copy: More info → Run anyway |
| Installer | NSIS crash / missing PE natives | Free CI silent `/S` install smoke + PE check on `better_sqlite3.node` |
| First launch | Wrong native ABI / missing resources | Rebuild `better-sqlite3` for Electron before pack; extraResources for MCP/skills |
| Defender | False positive quarantine | Free + paid CI run `Start-MpScan` on `apps/desktop/release` |

### Free public channel (grokdesk.app)

Workflow: `.github/workflows/release-free-github.yml`

- Builds NSIS on `windows-latest`, stages `GrokDesk-win-x64.exe`.
- **Signs when** `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (or shared `CSC_LINK`) are set in repo secrets.
- **If no cert:** packages unsigned and emits a CI warning. End users must click SmartScreen **More info → Run anyway**.
- Always runs: PE native check, keytar ban, silent install smoke, Defender scan.

### Paid / qualified channel

Workflow: `.github/workflows/release-desktop.yml` — requires signing (`forceCodeSigning=true`) and full Authenticode + timestamp verification.

## Qualified release targets

| Process target | Published? | Artifacts |
| --- | --- | --- |
| `win32-x64` | **Yes** (qualified) | **NSIS only** |
| `win32-arm64` | **No** (holdback) | Requires `QUALIFIED_WIN32_ARM64=1` + evidence file |
| portable EXE | **No** | Not part of paid/release path |

Release CI builds `win32-x64` only:

```bash
# Release packaging (NSIS; never portable)
pnpm --filter @grokdesk/desktop exec electron-builder --win --x64 --config.win.target=nsis --publish never

# Assert matrix + holdback
pnpm exec tsx scripts/assert-release-targets.ts
pnpm exec vitest run scripts/assert-release-targets.test.ts
```

Holdback evidence path (PATH standard):

`docs/releases/qualification/win32-arm64.md`

Template: [qualification-template.md](./releases/qualification-template.md).  
Workflow: `.github/workflows/release-desktop.yml`.

## Build installer (unsigned)

```bash
pnpm --filter @grokdesk/desktop build
pnpm --filter @grokdesk/desktop exec node scripts/rebuild-native-for-electron.mjs --platform win32 --arch x64
# From a Windows host (or CI), or use dist:win which sets signAndEditExecutable=false:
pnpm --filter @grokdesk/desktop run dist:win
```

Artifacts land under `apps/desktop/release/` (`directories.output`).

Local unsigned NSIS will still install; on a real user machine after a browser download, expect SmartScreen.

## Signed release (env flow)

| Variable | Purpose |
|----------|---------|
| `WIN_CSC_LINK` | Path or base64 of Windows `.pfx` / `.p12` (preferred for win jobs) |
| `WIN_CSC_KEY_PASSWORD` | Certificate password |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Shared cert fallback (also used for mac) |

```bash
export WIN_CSC_LINK="/secure/path/codesign.pfx"
export WIN_CSC_KEY_PASSWORD="…"

pnpm --filter @grokdesk/desktop build
pnpm --filter @grokdesk/desktop exec node scripts/rebuild-native-for-electron.mjs
pnpm --filter @grokdesk/desktop exec electron-builder --win --x64 --config.win.target=nsis --publish never
```

SmartScreen “unknown publisher” / “Windows protected your PC” remains until:

1. The installer is **Authenticode-signed** with a trusted certificate, and
2. (for new standard certs) the file builds **reputation**, or you use an **EV** code-signing cert which gets reputation immediately.

Code alone cannot clear SmartScreen. Configure `WIN_CSC_*` on the free release workflow for production downloads.

## Installer metadata

Configured in `apps/desktop/electron-builder.yml` and `package.json`:

- `appId` / `productName` / `legalTrademarks` (when set)
- NSIS options and `artifactName`
- Windows `AppUserModelId` set in main (`ai.x.grokdesk`) for taskbar grouping

## Product licensing (retired)

Grok Desk is **free**. Do **not** bake `GROKDESK_LICENSE_PUBLIC_KEY` at
electron-vite build time for Desk product-license verification. Free public
Windows builds use `.github/workflows/release-free-github.yml` and start without
a product key (see pipeline above). Historical notes:
[license-release-keys.md](./license-release-keys.md).

Optional **update / runtime** signature verification may bake
`GROKDESK_RELEASE_PUBLIC_KEYS` when update signing is configured — separate from
retired Desk product licensing. Never commit private keys.

## Release checklist (Windows x64)

### Free public builds (`release-free-github.yml`)

1. Gate: package smoke, PE native check, keytar ban, silent install smoke
2. NSIS signed when `WIN_CSC_*` present; otherwise document SmartScreen bypass path
3. Free app launches without a Desk product key; no license activation UX
4. Stage stable `GrokDesk-win-x64.exe`; no product-key secrets in artifacts
5. Do **not** require Desk product-license entitlement service imports

### Qualified matrix (optional; `release-desktop.yml`)

1. Gate job: typecheck / tests / contracts / `assert-release-targets` / package smoke
2. NSIS installer signed; `Get-AuthenticodeSignature` = Valid + timestamp
3. Standard-user install smoke; Verified Publisher (after cert reputation)
4. SHA-256 catalog for **update/runtime** artifacts; no `*Portable*` uploads
5. Qualification template completed on real hardware
6. Dual approval before stable **update** manifest sign

## win32-arm64 holdback

Do **not** add `win32-arm64` to the release matrix until:

1. Native Desk + native Grok artifacts exist for `win32-arm64`
2. Full suite evidence on real ARM64 hardware (see qualification template)
3. Evidence file committed at `docs/releases/qualification/win32-arm64.md`
4. Release job sets `QUALIFIED_WIN32_ARM64=1`
5. `scripts/assert-release-targets.ts` exits 0

Browser/portal download selectors must omit `win32-arm64` until the above is done.

Rollback / revoke: [bad-release-rollback.md](./runbooks/bad-release-rollback.md),
[artifact-revocation.md](./runbooks/artifact-revocation.md).
