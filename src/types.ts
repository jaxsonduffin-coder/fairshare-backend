// Core domain types for Fair Share AI.
// (We use a lightweight embedded JSON store instead of a full DB engine — see
// src/lib/store.ts — because this sandbox cannot reach external binary
// registries. The shape here is deliberately DB-agnostic so swapping in
// Postgres/Prisma later is a data-layer-only change.)

export type Tier = "BASIC" | "PRO" | "ADVANCED" | "ENTERPRISE" | "WHITE_LABEL";
export type Role = "CREATOR" | "ADMIN";
export type AthleteLevel = "NONE" | "COLLEGE";
export type Platform = "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "X" | "TWITCH" | "PODCAST";
export type ContentType = "POST" | "STORY" | "REEL" | "VIDEO" | "BUNDLE" | "APPEARANCE";
export type DealStatus = "DRAFT" | "NEGOTIATING" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "COMPLETED";
export type RoundActor = "BRAND" | "CREATOR" | "AI";
export type OutreachStatus = "DRAFT" | "MOCK_SENT" | "SENT" | "FAILED";

export interface User {
  id: string;
  email: string;
  // Optional because Sign in with Apple accounts never set a password —
  // they authenticate solely via a verified Apple identity token.
  passwordHash?: string;
  appleUserId?: string; // Apple's stable per-app "sub" claim, if linked
  role: Role;
  createdAt: string;
}

export interface CreatorProfile {
  id: string;
  userId: string;
  displayName: string;
  niche: string;
  isAthlete: boolean;
  athleteLevel: AthleteLevel;
  sport?: string;
  school?: string;
  graduationYear?: number;
  bio?: string;
  createdAt: string;
}

export interface SocialAccount {
  id: string;
  creatorProfileId: string;
  platform: Platform;
  handle: string;
  followers: number;
  engagementRate: number; // percent, e.g. 3.5
  createdAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  tier: Tier;
  status: "active" | "trialing" | "past_due" | "canceled";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
  aiNegotiationsUsedThisPeriod: number;
  periodStart: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agency {
  id: string;
  ownerUserId: string;
  name: string;
  brandColor: string;
  logoUrl?: string;
  createdAt: string;
}

export interface AgencyClient {
  id: string;
  agencyId: string;
  userId: string;
  addedAt: string;
}

export interface Brand {
  id: string;
  name: string;
  industry: string;
  website?: string;
  contactEmail: string;
  worksWithCreators: boolean;
  worksWithAthletes: boolean;
  typicalBudgetMin: number;
  typicalBudgetMax: number;
  preferredNiches: string[];
  notes?: string;
}

export interface Deal {
  id: string;
  creatorProfileId: string;
  brandId?: string;
  brandNameFreeText?: string;
  platform: Platform;
  contentType: ContentType;
  deliverables?: string;
  deadline?: string;
  initialOfferAmount?: number;
  currentAmount?: number;
  status: DealStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NegotiationRound {
  id: string;
  dealId: string;
  roundNumber: number;
  actor: RoundActor;
  amount: number;
  message?: string;
  rationale?: string;
  confidenceScore?: number;
  createdAt: string;
}

// A real closed-deal data point, captured automatically whenever a deal is
// marked ACCEPTED or COMPLETED (see routes/deals.ts). This is what lets the
// AI rate estimate improve over time from actual outcomes instead of only
// the static industry-benchmark table in lib/negotiation.ts — see that
// file's marketAdjustedBaseRate() for how these get blended in, and
// routes/market.ts for the tier-gated "market rate lookup" / "market
// intelligence dashboard" features built on top of this data.
export interface MarketRateSample {
  id: string;
  dealId: string; // one sample per deal — re-recorded in place if its status changes again (e.g. ACCEPTED -> COMPLETED)
  platform: Platform;
  contentType: ContentType;
  niche: string;
  followers: number;
  engagementRate: number;
  isAthlete: boolean;
  finalAmount: number; // the agreed dollar amount the deal actually closed at
  ratePer1000: number; // finalAmount / (followers / 1000) — the normalized figure aggregation runs on
  createdAt: string;
}

export interface OutreachEmail {
  id: string;
  creatorProfileId: string;
  brandId: string;
  subject: string;
  body: string;
  status: OutreachStatus;
  createdAt: string;
  sentAt?: string;
}

export const TIER_ORDER: Tier[] = ["BASIC", "PRO", "ADVANCED", "ENTERPRISE", "WHITE_LABEL"];

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}
