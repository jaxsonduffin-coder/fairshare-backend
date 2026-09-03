import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  User, CreatorProfile, SocialAccount, Subscription, Agency, AgencyClient,
  Brand, Deal, NegotiationRound, OutreachEmail, MarketRateSample,
} from "../types";
import { pgLoad, pgSave, pgReset, pgClosePool } from "./pgBackend";

// The data layer for the whole app, in one small file, on purpose: every
// route handler reads/mutates the plain in-memory arrays below
// synchronously (db.users.find(...), db.deals.push(...), etc.) — see
// APP_STORE_READINESS.md §4 for why. This file owns turning that into
// something durable, without the rest of the app ever knowing which backend
// is in play:
//
//   DATABASE_URL starting with postgres(ql):// -> real Postgres (see
//   pgBackend.ts) — a single JSONB row, written through on every mutation.
//   Real backups, survives redeploys, safe under concurrent writes at the
//   database layer.
//
//   anything else (e.g. "file:./dev.db") -> a local JSON file. Zero setup,
//   used for fast tests and for trying the app without standing up
//   Postgres — not meant for production (see the file-vs-Postgres tradeoff
//   spelled out in APP_STORE_READINESS.md).

interface Schema {
  users: User[];
  creatorProfiles: CreatorProfile[];
  socialAccounts: SocialAccount[];
  subscriptions: Subscription[];
  agencies: Agency[];
  agencyClients: AgencyClient[];
  brands: Brand[];
  deals: Deal[];
  negotiationRounds: NegotiationRound[];
  outreachEmails: OutreachEmail[];
  marketRateSamples: MarketRateSample[];
}

function emptySchema(): Schema {
  return {
    users: [], creatorProfiles: [], socialAccounts: [], subscriptions: [],
    agencies: [], agencyClients: [], brands: [], deals: [],
    negotiationRounds: [], outreachEmails: [], marketRateSamples: [],
  };
}

function isPostgres(): boolean {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "..", "data.json");

let data: Schema = emptySchema();

function loadFromFile(): Schema {
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      return { ...emptySchema(), ...parsed }; // backfill keys added since the file was last written
    } catch {
      return emptySchema();
    }
  }
  return emptySchema();
}

async function loadDb(): Promise<void> {
  data = isPostgres() ? await pgLoad(emptySchema) : loadFromFile();
}

// Resolves once initial data has been loaded. Every entrypoint (server.ts,
// the test setup) awaits this before doing anything else — see the module
// comment above for why `db.*` itself stays synchronous.
export const dbReady: Promise<void> = loadDb();

// Writes are chained (not just debounced) so that under concurrent
// mutations, the Postgres row always ends up matching whichever in-memory
// snapshot was captured *last* — never an earlier one that happened to
// finish its network round-trip sooner. See pgBackend.ts's comment for the
// broader durability tradeoffs of this design.
let writeChain: Promise<void> = Promise.resolve();
let saveScheduled = false;

function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  queueMicrotask(() => {
    saveScheduled = false;
    const snapshot = data;
    writeChain = writeChain.then(() =>
      isPostgres() ? pgSave(snapshot) : Promise.resolve(fs.writeFileSync(DB_FILE, JSON.stringify(snapshot, null, 2)))
    );
  });
}

/** Fire-and-forget persistence, called after every mutation. See flushDb()
 *  for when you actually need to wait for it (graceful shutdown, tests
 *  asserting durability). */
export function persist(): void {
  scheduleSave();
}

/** Waits for any pending/in-flight write to finish. Call this before the
 *  process exits (see server.ts) so a deploy/restart never drops the last
 *  few mutations.
 *
 *  Note this has to actively wait for a *scheduled-but-not-yet-run* write,
 *  not just await the current `writeChain` promise: persist() defers the
 *  actual chaining to a microtask (to coalesce a burst of mutations into one
 *  write), so calling flushDb() immediately after persist() would otherwise
 *  capture a stale writeChain reference from before that microtask runs. */
export async function flushDb(): Promise<void> {
  while (saveScheduled) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  await writeChain;
}

export async function resetDb(): Promise<void> {
  if (isPostgres()) {
    await pgReset(emptySchema);
    data = emptySchema();
  } else {
    data = emptySchema();
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }
}

/** Test-only: release the Postgres connection pool so Jest can exit cleanly. */
export async function closeDbForTests(): Promise<void> {
  await flushDb();
  await pgClosePool();
}

// Full account deletion (Apple Guideline 5.1.1(v) requires this be reachable
// from inside the app, not just via a support request). Cascades through
// every record that references the user, directly or via their creator
// profile, so no orphaned data is left behind.
export function deleteUserCascade(userId: string) {
  const profile = data.creatorProfiles.find((p) => p.userId === userId);
  const profileId = profile?.id;

  data.socialAccounts = profileId ? data.socialAccounts.filter((s) => s.creatorProfileId !== profileId) : data.socialAccounts;
  data.outreachEmails = profileId ? data.outreachEmails.filter((o) => o.creatorProfileId !== profileId) : data.outreachEmails;

  const dealIds = new Set(
    profileId ? data.deals.filter((d) => d.creatorProfileId === profileId).map((d) => d.id) : []
  );
  data.negotiationRounds = data.negotiationRounds.filter((r) => !dealIds.has(r.dealId));
  data.deals = profileId ? data.deals.filter((d) => d.creatorProfileId !== profileId) : data.deals;

  data.creatorProfiles = data.creatorProfiles.filter((p) => p.userId !== userId);
  data.subscriptions = data.subscriptions.filter((s) => s.userId !== userId);

  const ownedAgency = data.agencies.find((a) => a.ownerUserId === userId);
  if (ownedAgency) {
    data.agencyClients = data.agencyClients.filter((c) => c.agencyId !== ownedAgency.id);
    data.agencies = data.agencies.filter((a) => a.id !== ownedAgency.id);
  }
  data.agencyClients = data.agencyClients.filter((c) => c.userId !== userId);

  data.users = data.users.filter((u) => u.id !== userId);
  persist();
}

export function id(): string {
  return crypto.randomBytes(12).toString("hex");
}

export function now(): string {
  return new Date().toISOString();
}

export const db = {
  get users() { return data.users; },
  get creatorProfiles() { return data.creatorProfiles; },
  get socialAccounts() { return data.socialAccounts; },
  get subscriptions() { return data.subscriptions; },
  get agencies() { return data.agencies; },
  get agencyClients() { return data.agencyClients; },
  get brands() { return data.brands; },
  get deals() { return data.deals; },
  get negotiationRounds() { return data.negotiationRounds; },
  get outreachEmails() { return data.outreachEmails; },
  get marketRateSamples() { return data.marketRateSamples; },
};
