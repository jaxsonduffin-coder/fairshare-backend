import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";
import { dbReady, flushDb } from "./lib/store";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

async function main() {
  await dbReady;
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
