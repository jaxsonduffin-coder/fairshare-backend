import { Pool } from "pg";

// The whole app's data as one JSON document, stored durably in Postgres.
//
// Why one JSONB blob instead of a normalized relational schema: this
// migration's job was to get off local-disk-only storage (no backups, one
// server's filesystem, gone on redeploy) onto a real managed database with
// backups and durability, WITHOUT rewriting every route handler in the app
// (they all read/mutate plain in-memory arrays synchronously — see
// store.ts). A single JSONB row, written through on every mutation, gets
// real durability and ACID writes with a data-layer-only change, exactly as
// promised in APP_STORE_READINESS.md. Normalizing into real tables (with
// indexes, foreign keys, and the ability to query without loading
// everything into memory) is the right next step once data volume actually
// warrants it — flagged there, not pretended away here.
const TABLE = "app_state";

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
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function pgLoad<T>(emptySchema: () => T): Promise<T> {
  await ensureTable();
  const res = await getPool().query(`SELECT data FROM ${TABLE} WHERE id = 1`);
  if (res.rows.length === 0) {
    const initial = emptySchema();
    await getPool().query(`INSERT INTO ${TABLE} (id, data) VALUES (1, $1)`, [JSON.stringify(initial)]);
    return initial;
  }
  // Backfill any keys added to the schema since this row was last written
  // (mirrors store.ts's loadFromFile doing the same for the JSON-file
  // backend) — otherwise a field added in a later release, like
  // marketRateSamples, would be `undefined` on every existing production
  // database instead of an empty array, crashing the first .push() into it.
  return { ...(emptySchema() as object), ...(res.rows[0].data as object) } as T;
}

export async function pgSave(data: unknown): Promise<void> {
  await getPool().query(`UPDATE ${TABLE} SET data = $1, updated_at = now() WHERE id = 1`, [JSON.stringify(data)]);
}

export async function pgReset(emptySchema: () => unknown): Promise<void> {
  await ensureTable();
  await getPool().query(`DELETE FROM ${TABLE}`);
  await getPool().query(`INSERT INTO ${TABLE} (id, data) VALUES (1, $1)`, [JSON.stringify(emptySchema())]);
}

export async function pgClosePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
