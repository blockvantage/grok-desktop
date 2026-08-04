const ABI_MISMATCH =
  /NODE_MODULE_VERSION|was compiled against a different Node\.js/i;

/**
 * Loading better-sqlite3 is not enough: its native binding is loaded lazily
 * when a Database is opened. Probe an in-memory database and close it at once.
 */
export function nativeBindingNeedsRebuild(loadDatabase) {
  try {
    const Database = loadDatabase();
    const db = new Database(":memory:");
    db.close();
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ABI_MISMATCH.test(message)) return true;
    throw error;
  }
}
