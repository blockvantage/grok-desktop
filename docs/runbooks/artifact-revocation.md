# Runbook: Artifact revocation

## Purpose

Revoke a Desk installer and/or managed Grok runtime artifact so new grants and
updates stop selecting it. Revocation is stronger than cohort pause: it
overrides rollout percentage for that artifact ID.

## When to revoke

- Confirmed security issue in a shipped binary
- Critical functional break with no safe client-side workaround
- Wrong architecture / non-native binary shipped for a target
- Signing identity compromise for a specific build
- Accidental publication of **portable Windows** or **win32-arm64** before
  qualification

Do **not** revoke for minor UX bugs — use [bad-release-rollback](./bad-release-rollback.md)
and rollout pause instead.

## Preconditions

| Check | Required |
| --- | --- |
| Operator identity (OIDC / SSO) | Yes |
| Second approver (stable channel) | Yes |
| Artifact ID + SHA-256 | Yes |
| Release sequence / channel | Yes |
| Reason code + free-text reason | Yes |
| Customer-safe summary | Yes |

Never put product keys, lease JWTs, download grant tokens, or private signing
material into the revocation ticket.

## Procedure

### 1. Identify the artifact

Record:

- `artifactId` (catalog ID)
- `target` (`darwin-arm64` | `darwin-x64` | `win32-x64` | `win32-arm64`)
- `kind` (`desk` | `grok`)
- `version`
- `sha256`
- First-seen release sequence

### 2. Request revocation

In the entitlement release service (operator CLI or console):

```text
artifact revoke \
  --artifact-id <id> \
  --expected-sequence <n> \
  --reason <code> \
  --operator <subject> \
  --note "<customer-safe note>"
```

Stable channel requires **request → second-person approve → execute** against an
exact action digest before expiry.

### 3. Publish updated manifest

1. Increment manifest `sequence`.
2. Add artifact to `revocations` (or equivalent catalog field).
3. Remove or replace pairs that referenced only the revoked artifact.
4. Dual-approve stable publication (KMS; this repo never holds the private key).

### 4. Invalidate grants (if private mirror)

- Mark outstanding single-use download grants for that artifact as unusable
- Prefer fail-closed on grant redemption when artifact is revoked
- CDN/permanent URL: remove or replace objects; do not leave anonymous hotlinks

### 5. Client behavior expectations

- Already-installed copies keep running until the user updates (revocation is
  not a remote kill switch for offline disks)
- New resolves / updates must not select a revoked artifact
- In-app UI surfaces a safe error (no raw stack / grant token)

## win32-arm64 / portable special cases

| Situation | Action |
| --- | --- |
| `win32-arm64` appeared in publish matrix without qualification | Delete artifacts; ensure `QUALIFIED_WIN32_ARM64` unset; run `scripts/assert-release-targets.ts` |
| Portable Windows EXE published | Revoke portable artifact IDs; paid path is **NSIS only** for `win32-x64` |
| Evidence file missing | Do not re-publish until [qualification template](../releases/qualification-template.md) is complete under `docs/releases/qualification/` |

## Verification

- [ ] Revocation audit row: operator, approver, artifact ID, SHA-256, timestamp
- [ ] Manifest fetch (stable) no longer resolves pairs using the artifact
- [ ] Fresh grant redeem for revoked artifact fails closed
- [ ] Cohort inspect shows artifact blocked regardless of percentage
- [ ] Support macro updated

## Rollback of a mistaken revocation

1. Only if the artifact is actually safe and still signed.
2. Requires dual approval and a **new** sequence that removes the revocation
   entry (do not rewrite history of prior sequences).
3. Re-run smoke on each affected target.

## Related

- [Bad release rollback](./bad-release-rollback.md)
- [Qualification template](../releases/qualification-template.md)
- `.github/workflows/release-desktop.yml`
- `scripts/assert-release-targets.ts`
