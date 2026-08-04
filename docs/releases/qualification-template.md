# Desktop release qualification template

Use one copy of this template **per process target** before stable manifest
signing. Automated CI (`.github/workflows/release-desktop.yml`) builds only
qualified targets; this document is the **real-machine evidence** record.

## Identity

| Field | Value |
| --- | --- |
| Release / tag | |
| Desk version | |
| Grok runtime version (if paired) | |
| Channel (`stable` / `beta` / …) | |
| Process target | `darwin-arm64` / `darwin-x64` / `win32-x64` / `win32-arm64` |
| Operator | |
| Reviewer (second person for stable) | |
| Date (UTC) | |

## Hardware & OS (required)

| Field | Value |
| --- | --- |
| Real hardware ID (asset tag / serial redacted form) | |
| CPU / SoC | |
| RAM | |
| Disk free at start | |
| OS name + build | |
| Display / locale / timezone | |
| Network (direct / proxy / corp) | |
| Account type (admin / standard user) | |

> Never paste product keys, activation signatures, device private keys, lease
> JWTs, raw serials that double as secrets, or customer PII into this file.

## Artifact evidence (required)

| Field | Value |
| --- | --- |
| Desk artifact name | |
| Desk SHA-256 | |
| Desk size (bytes) | |
| Desk signing identity | |
| Notarization / Authenticode result | |
| Staple / timestamp evidence link | |
| Grok artifact name (native for this target) | |
| Grok SHA-256 | |
| Grok signing evidence | |
| SBOM / scan report link | |
| CI run URL | |

## Suite results

Mark each row **pass** / **fail** / **n/a** with a short note or evidence link.

### Common

| Case | Result | Evidence |
| --- | --- | --- |
| Clean install (no global Grok) | | |
| Gatekeeper / Verified Publisher | | |
| Activation (GD3 + lease) | | |
| Credential vault persistence (Keychain / Credential Manager) | | |
| Managed runtime install | | |
| First real task completes | | |
| Update from previous stable | | |
| Interrupted download resume | | |
| Runtime probe failure handling | | |
| Rollback to previous runtime | | |
| Repair (runtime only; data preserved) | | |
| Uninstall data-choice | | |

### macOS extras (`darwin-*`)

| Case | Result | Evidence |
| --- | --- | --- |
| `codesign --verify --deep --strict` | | |
| `spctl --assess` | | |
| Notarization + `stapler validate` (DMG + updater ZIP) | | |
| Hardened runtime | | |

### Windows x64 extras (`win32-x64`)

| Case | Result | Evidence |
| --- | --- | --- |
| NSIS install (standard user) | | |
| Authenticode Valid + timestamp | | |
| Antivirus quarantine simulation | | |
| File lock during update | | |
| Proxy | | |
| Long path | | |
| Non-ASCII username | | |

### Windows ARM64 extras (`win32-arm64` holdback)

`win32-arm64` remains **unpublished** until every field below is complete and
`QUALIFIED_WIN32_ARM64=1` is set for the release job **with this evidence file
checked in** at:

`docs/releases/qualification/win32-arm64.md`

| Case | Result | Evidence |
| --- | --- | --- |
| Native Desk artifact (not x64-emulated only) | | |
| Native Grok artifact for `win32-arm64` | | |
| Full suite above on real ARM64 hardware | | |
| Real hardware ID recorded | | |
| Signing evidence for both Desk + Grok | | |
| Explicit dual approval to publish | | |

## Explicit approval

```
I confirm this target is qualified for publication on the stated channel.
Operator: _______________  date: _______________
Reviewer: _______________  date: _______________
```

## Related runbooks

- [Bad release rollback](../runbooks/bad-release-rollback.md)
- [Artifact revocation](../runbooks/artifact-revocation.md)
- [macOS packaging](../packaging-macos.md)
- [Windows packaging](../packaging-windows.md)
