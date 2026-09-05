import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";
import { dbReady, flushDb, db, id, persist } from "./lib/store";
import { demoBrands } from "./seed";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

// Self-heals an empty brand directory on boot (e.g. a fresh production
// database that has never had seed.ts run against it). Only ever pushes into
// db.brands — never touches any other collection, so this is safe to run on
// every restart: once brands exist, it is a no-op.
async function seedBrandsIfEmpty(): Promise<void> {
  if (db.brands.length > 0) return;
  demoBrands.forEach((b) => db.brands.push({ ...b, id: id() }));
  persist();
  await flushDb();
  console.log(`Brand directory was empty — seeded ${db.brands.length} starter brands.`);
}

async function main() {
  await dbReady;
  await seedBrandsIfEmpty();
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Fair Share AI backend listening on http://localhost:${port}`);
  });

  // On Render/Fly/Railway a deploy or restart sends SIGTERM before killing
  // the process — flush any pending write first so the last few mutations
  // before shutdown aren't lost (see store.ts's writeChain).
  async function shutdown(signal: string) {
    console.log(`${signal} received, flushing pending writes before exit...`);
    server.close();
    await flushDb();
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
