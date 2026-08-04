# Runbook: Database backup and restore (entitlement PostgreSQL)

## Purpose

Protect entitlement state (orders, entitlements, activations, leases, outbox,
audit) with encrypted backups and point-in-time recovery (PITR). Verify
restorability with periodic drills that leave no long-lived restore instances.

## Targets

| Metric | Target | Notes |
| --- | --- | --- |
| **RPO** | ≤ 15 minutes | Continuous WAL / PITR where available |
| **RTO** | ≤ 60 minutes | Isolated restore + cutover decision |
| **Full backup** | Daily | Encrypted at rest (provider KMS / age / GPG) |
| **Restore drill** | Monthly (minimum) | Documented evidence required |

Related alerts: `EntitlementBackupFailure`, `EntitlementRestorePointAgeHigh`
(`services/entitlement-api/src/observability/alerts.yml`).

## PATH layout (ops evidence)

Never store product keys, private PKCS#8, portal tokens, or raw emails in
drill evidence. Safe paths only:

```
docs/evidence/
  restore-drills/
    YYYY-MM-DD-entitlement-restore.md   # duration, RPO/RTO, backup ID, counts
```

Operator workspace (ephemeral):

```
/tmp/entitlement-restore-drill-<ts>/
  backup.dump          # or provider snapshot reference only
  drill-report.txt     # safe counts / checksums
```

Destroy the directory after the drill.

## Backup procedure (managed PostgreSQL)

1. Confirm continuous backup / PITR is enabled on the production instance.
2. Confirm encryption at rest and restricted IAM for backup objects.
3. Record backup job success into the operator metric feed:
   - `entitlement_api_backup_last_success_timestamp`
4. Retain at least 7 daily full backups + PITR window ≥ 7 days (or org policy).

## Manual logical dump (break-glass)

```bash
# Production credentials from secret store — never commit.
export PGHOST=... PGPORT=5432 PGUSER=... PGDATABASE=entitlements
pg_dump --format=custom --no-owner --file="entitlements-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Encrypt before off-host transfer (example: age / gpg).
```

## Restore drill (isolated instance)

**Goal:** prove a backup restores cleanly, then destroy the instance.

### Automated dry drill (Docker)

From `services/entitlement-api` when Docker is available:

```bash
./scripts/restore-drill.sh
# Optional: RESTORE_DRILL_DUMP=/path/to.dump ./scripts/restore-drill.sh
```

The script:

1. Starts a throwaway Postgres 16 container with a unique name.
2. Restores either a provided dump or applies checked-in migrations (schema-only dry path).
3. Verifies `schema_migrations` row count matches the expected migration set.
4. Writes safe counts (migrations, optional table counts) to stdout.
5. Always removes the container and network aliases (trap on EXIT).

**Do not** leave restore containers running. **Do not** point the drill at production.

### Manual restore (provider snapshot / dump)

1. Create an isolated PostgreSQL 16 instance (new cluster or container).
2. Restore the encrypted backup; decrypt only in memory / tmpfs when possible.
3. Run verification queries (no secret columns in output):

```sql
SELECT COUNT(*) AS migration_count FROM schema_migrations;
SELECT version, name, checksum FROM schema_migrations ORDER BY version;

-- Optional volume checks (counts only):
SELECT COUNT(*) AS orders FROM orders;
SELECT COUNT(*) AS entitlements FROM entitlements;
SELECT COUNT(*) AS activations FROM activations;
```

4. Optional crypto smoke (public material only):
   - Reconstruct one product key from **test** seed material if present in the
     restored fixture DB — never production buyer keys in logs.
   - Verify one lease JWS with the **public** key set from
     `/.well-known` or the restored `signing_keys` public rows.
5. Record: wall-clock duration, observed RPO (backup age), RTO, backup ID,
   `schema_migrations` count, and SHA-256 of migration checksums concatenated
   (safe). No PII, no private keys.
6. Destroy the isolated instance and shred local dump files.

## Production restore (incident)

1. Declare incident; page on-call. See also
   [entitlement-outage.md](./entitlement-outage.md).
2. Freeze writes if partial corruption is suspected (maintenance mode / scale
   API to zero).
3. Choose restore point (latest consistent vs PITR timestamp).
4. Restore to a new instance first when possible; validate migration checksums.
5. Cut traffic only after verification; rotate any credentials that may have
   been exposed during the incident.
6. File drill/incident evidence under `docs/evidence/restore-drills/`.

## Failures

| Symptom | Action |
| --- | --- |
| Backup job missing > 26h | Page; `EntitlementBackupFailure`; fix job, run ad-hoc dump |
| Restore checksum mismatch | Stop; do not cut over; try prior backup |
| Migration version skew | Compare `schema_migrations` to release tag; re-run migrate only on empty/new |

## Contacts

- Entitlement on-call
- Data platform / DBA for managed PITR
- Security for key-material handling during break-glass dumps
