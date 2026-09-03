import { Pool } from "pg";

// The whole app's data as one JSON document per collection, stored durably
// in Postgres — one row per top-level collection (users, deals, ...)
// instead of a single row for the entire app.
//
// Why per-collection rows instead of either (a) one giant JSONB blob for
// everything, or (b) a fully normalized relational schema: the original
// one-blob design meant EVERY mutation anywhere in the app — one user
// updating their profile, one deal getting a new negotiation round — wrote
// through the *entire* dataset on every save. That's fine at the low
// hundreds-of-users scale this app started at, but becomes the dominant
// cost well before real growth: write latency scales with total app data,
// not with the size of what actually changed, and writes are chained (see
// store.ts's writeChain), so every mutation queues behind rewriting
// everyone else's data too. Splitting into one row per collection means a
// save only touches the collection(s) that actually changed — store.ts
// diffs before saving — which removes that bottleneck without touching a
// single route handler, since routes still only ever see plain in-memory
// arrays via db.*.
//
// Full normalization into per-record tables (indexes, foreign keys,
// queries that don't require loading everything into memory) is still the
// right next step once you need to query without holding the whole
// dataset in one process's RAM, or scale across more than one server
// instance — this only fixes the write-amplification problem, not that
// one. Flagged here, not pretended away.
const TABLE = "app_collections";

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

async function ensureTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Loads every collection row into a plain { collectionName: value } map.
 *  Collections missing from the table (a brand new database, or a field
 *  added to the schema in a later release) are backfilled from
 *  emptySchema() and written through immediately — mirrors store.ts's old
 *  loadFromFile behavior so a field like marketRateSamples never shows up
 *  as `undefined` and crashes the first .push() into it. */
export async function pgLoad<T extends object>(emptySchema: () => T): Promise<T> {
  await ensureTable();
  const res = await getPool().query(`SELECT key, data FROM ${TABLE}`);
  const found: Record<string, unknown> = {};
  for (const row of res.rows) found[row.key] = row.data;

  const empty = emptySchema() as unknown as Record<string, unknown>;
  const missing = Object.keys(empty).filter((k) => !(k in found));
  if (missing.length > 0) {
    await getPool().query(
      `INSERT INTO ${TABLE} (key, data) SELECT * FROM UNNEST($1::text[], $2::jsonb[])`,
      [missing, missing.map((k) => JSON.stringify(empty[k]))]
    );
    for (const k of missing) found[k] = empty[k];
  }
  return { ...empty, ...found } as T;
}

/** Writes only the given collections — call with just what changed since
 *  the last save, not the whole dataset. A no-op (no query at all) when
 *  nothing changed. */
export async function pgSaveCollections(changed: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(changed);
  if (keys.length === 0) return;
  await getPool().query(
    `
      INSERT INTO ${TABLE} (key, data)
      SELECT * FROM UNNEST($1::text[], $2::jsonb[])
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `,
    [keys, keys.map((k) => JSON.stringify(changed[k]))]
  );
}

export async function pgReset(emptySchema: () => object): Promise<void> {
  await ensureTable();
  await getPool().query(`DELETE FROM ${TABLE}`);
  const empty = emptySchema() as unknown as Record<string, unknown>;
  const keys = Object.keys(empty);
  await getPool().query(
    `INSERT INTO ${TABLE} (key, data) SELECT * FROM UNNEST($1::text[], $2::jsonb[])`,
    [keys, keys.map((k) => JSON.stringify(empty[k]))]
  );
}

export async function pgClosePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
