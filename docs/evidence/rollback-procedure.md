# Database / release rollback procedure

**Last updated:** 2026-07-14

## Schema migrations

1. **Before migrate:** `openDatabase` copies  
   `{dbPath}.pre-migrate-v{from}-to-v{to}.bak` when upgrading.
2. **Safe upgrade path:** fixtures under `packages/gateway/testdata/migrations/`  
   (v1, v2, v3) upgrade to current (`CURRENT_SCHEMA_VERSION`).
3. **Downgrade:** Not supported. Opening a newer DB with older code that  
   expects a lower schema is refused by missing columns/tables — do not  
   auto-mutate downward. Restore from `.pre-migrate-*.bak` if needed:

```bash
# Example (stop Desk first)
cp "$GROKDESK_DATA/db.sqlite.pre-migrate-v3-to-v6.bak" "$GROKDESK_DATA/db.sqlite"
# Also restore -wal/-shm if present from the backup epoch
```

4. **Verify:** `pnpm --filter @grokdesk/gateway test -- src/db.migration`

## Application rollback

1. Reinstall previous signed build / git tag.
2. Restore DB backup taken before the upgrade.
3. Confirm `pnpm typecheck && pnpm test && pnpm test:remote` on the tag.
4. Production relay is external (`grok-landing`) — roll back that deploy  
   separately; Desk remains content-blind to relay plaintext.

## Credential vault

**SQLite literal → vault ref migration** runs automatically on gateway start
(AES-GCM file vault under `dataDir/credential-vault/`). This rewrites
settings JSON only; it does not wipe OS keychain / safeStorage.

**OS keychain mass purge** is **not** automated without authorization.
If purge is authorized, take a full data-dir backup first.
