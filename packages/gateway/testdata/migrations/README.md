# Database migration fixtures

One SQLite fixture per historical schema version. Upgrade tests open each file
via `openDatabase` and assert the result reaches the current schema version
without data loss for known columns.

| Version | File | Contents |
|---|---|---|
| 0 | `v0-empty/` | No DB file — empty path before first open |
| 1 | `v1-base.sql` | Core tables only (pre-title, pre-remote) |
| 2 | `v2-title.sql` | v1 + `tasks.title` |
| 3 | `v3-remote.sql` | v2 + `remote_devices` / `remote_pair_challenges` |

Fixtures are applied by tests that build temp DBs from SQL scripts (not binary
SQLite files) so they stay readable and git-friendly.
