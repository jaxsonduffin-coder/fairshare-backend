import { Router } from "express";
import { z } from "zod";
import { db, id, now, persist } from "../lib/store";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { estimateFairRate, generateCounterOffer } from "../lib/negotiation";
import { polishNegotiationCopy } from "../lib/ai";
import { TIERS } from "../lib/tiers";
import { CreatorProfile, Deal, Platform, Tier } from "../types";

const router = Router();
router.use(requireAuth);

const ACTIVE_STATUSES = new Set(["DRAFT", "NEGOTIATING", "COUNTERED"]);

function getProfile(userId: string) {
  return db.creatorProfiles.find((p) => p.userId === userId);
}
function getSubscription(userId: string) {
  return db.subscriptions.find((s) => s.userId === userId);
}

const createDealSchema = z.object({
  brandId: z.string().optional(),
  brandNameFreeText: z.string().optional(),
  platform: z.enum(["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "X", "TWITCH", "PODCAST"]),
  contentType: z.enum(["POST", "STORY", "REEL", "VIDEO", "BUNDLE", "APPEARANCE"]),
  deliverables: z.string().optional(),
  deadline: z.string().optional(),
  initialOfferAmount: z.number().nonnegative().optional(),
  expectedViews: z.number().int().nonnegative().optional(),
});

router.post("/", (req: AuthedRequest, res) => {
  const profile = getProfile(req.userId!);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const sub = getSubscription(req.userId!);
  const tier: Tier = sub?.tier ?? "BASIC";
  const tierDef = TIERS[tier];

  const activeCount = db.deals.filter(
    (d) => d.creatorProfileId === profile.id && ACTIVE_STATUSES.has(d.status)
  ).length;
  if (tierDef.maxActiveDeals !== null && activeCount >= tierDef.maxActiveDeals) {
    return res.status(403).json({
      error: `Your ${tierDef.name} plan allows up to ${tierDef.maxActiveDeals} active deals. Upgrade to add more.`,
      currentTier: tier,
    });
  }

  const parsed = createDealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  if (!parsed.data.brandId && !parsed.data.brandNameFreeText) {
    return res.status(400).json({ error: "Provide either brandId or brandNameFreeText" });
  }

  const deal: Deal = {
    id: id(),
    creatorProfileId: profile.id,
    brandId: parsed.data.brandId,
    brandNameFreeText: parsed.data.brandNameFreeText,
    platform: parsed.data.platform as Platform,
    contentType: parsed.data.contentType,
    deliverables: parsed.data.deliverables,
    deadline: parsed.data.deadline,
    initialOfferAmount: parsed.data.initialOfferAmount,
    currentAmount: parsed.data.initialOfferAmount,
    expectedViews: parsed.data.expectedViews,
    status: parsed.data.initialOfferAmount ? "NEGOTIATING" : "DRAFT",
    createdAt: now(),
    updatedAt: now(),
  };
  db.deals.push(deal);

  if (parsed.data.initialOfferAmount) {
    db.negotiationRounds.push({
      id: id(),
      dealId: deal.id,
      roundNumber: 1,
      actor: "BRAND",
      amount: parsed.data.initialOfferAmount,
      message: "Initial offer",
      createdAt: now(),
    });
  }
  persist();
  res.status(201).json({ deal });
});

router.get("/", (req: AuthedRequest, res) => {
  const profile = getProfile(req.userId!);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const deals = db.deals.filter((d) => d.creatorProfileId === profile.id);
  res.json({ deals });
});

type DealOwnedResult =
  | { error: number; msg: string }
  | { deal: Deal; profile: ReturnType<typeof getProfile> & object };

function getDealOwned(req: AuthedRequest, dealId: string): DealOwnedResult {
  const profile = getProfile(req.userId!);
  if (!profile) return { error: 404, msg: "Profile not found" };
  const deal = db.deals.find((d) => d.id === dealId && d.creatorProfileId === profile.id);
  if (!deal) return { error: 404, msg: "Deal not found" };
  return { deal, profile };
}

router.get("/:id", (req: AuthedRequest, res) => {
  const result = getDealOwned(req, String(req.params.id));
  if ("error" in result) return res.status(result.error).json({ error: result.msg });
  const rounds = db.negotiationRounds
    .filter((r) => r.dealId === result.deal.id)
    .sort((a, b) => a.roundNumber - b.roundNumber);
  res.json({ deal: result.deal, rounds });
});

const updateDealSchema = z.object({
  deliverables: z.string().optional(),
  deadline: z.string().optional(),
  expectedViews: z.number().int().nonnegative().optional(),
});

// Lets a creator fill in details after the deal exists — most importantly the
// expected view count, which they usually don't know at the moment a brand
// first reaches out.
router.patch("/:id", (req: AuthedRequest, res) => {
  const result = getDealOwned(req, String(req.params.id));
  if ("error" in result) return res.status(result.error).json({ error: result.msg });

  const parsed = updateDealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  Object.assign(result.deal, parsed.data);
  result.deal.updatedAt = now();
  persist();
  res.json({ deal: result.deal });
});

const roundSchema = z.object({
  actor: z.enum(["BRAND", "CREATOR"]),
  amount: z.number().nonnegative(),
  message: z.string().optional(),
});

// Record a human-entered round: the brand made a new offer, or the creator
// manually sent their own counter (outside of / after the AI suggestion).
router.post("/:id/rounds", (req: AuthedRequest, res) => {
  const result = getDealOwned(req, String(req.params.id));
  if ("error" in result) return res.status(result.error).json({ error: result.msg });
  const { deal } = result;

  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const priorRounds = db.negotiationRounds.filter((r) => r.dealId === deal.id);
  const roundNumber = priorRounds.length + 1;

  const round = {
    id: id(),
    dealId: deal.id,
    roundNumber,
    actor: parsed.data.actor,
    amount: parsed.data.amount,
    message: parsed.data.message,
    createdAt: now(),
  };
  db.negotiationRounds.push(round);

  deal.currentAmount = parsed.data.amount;
  deal.status = "NEGOTIATING";
  deal.updatedAt = now();
  persist();
  res.status(201).json({ round, deal });
});

// The core AI feature: look at the latest offer on this deal and generate a
// data-backed counter-offer recommendation.
router.post("/:id/negotiate", async (req: AuthedRequest, res) => {
  const result = getDealOwned(req, String(req.params.id));
  if ("error" in result) return res.status(result.error).json({ error: result.msg });
  const { deal, profile } = result;

  const sub = getSubscription(req.userId!);
  if (!sub) return res.status(404).json({ error: "No subscription found" });
  const tierDef = TIERS[sub.tier];

  if (tierDef.aiNegotiationsPerMonth !== null && sub.aiNegotiationsUsedThisPeriod >= tierDef.aiNegotiationsPerMonth) {
    return res.status(403).json({
      error: `Your ${tierDef.name} plan includes ${tierDef.aiNegotiationsPerMonth} AI negotiations/month, and you've used them all this period. Upgrade for unlimited AI negotiation.`,
      currentTier: sub.tier,
    });
  }

  const rounds = db.negotiationRounds
    .filter((r) => r.dealId === deal.id)
    .sort((a, b) => a.roundNumber - b.roundNumber);
  const lastBrandRound = [...rounds].reverse().find((r) => r.actor === "BRAND");
  const brandOfferAmount = lastBrandRound?.amount ?? deal.currentAmount;
  if (brandOfferAmount === undefined) {
    return res.status(400).json({ error: "No brand offer recorded yet for this deal — add one via POST /deals/:id/rounds first." });
  }

  const account = db.socialAccounts.find(
    (a) => a.creatorProfileId === profile.id && a.platform === deal.platform
  ) ?? db.socialAccounts.find((a) => a.creatorProfileId === profile.id);

  if (!account) {
    return res.status(400).json({ error: "Add a social account with follower/engagement data to your profile before negotiating." });
  }

  // Blend in real closed-deal data (see lib/negotiation.ts) if enough of it
  // exists yet — marketAdjustedBaseRate() internally filters this down to
  // the relevant platform/content-type/niche, so it's fine to just hand it
  // every sample on record.
  const rate = estimateFairRate(
    {
      platform: deal.platform,
      contentType: deal.contentType,
      followers: account.followers,
      engagementRate: account.engagementRate,
      niche: profile.niche,
    },
    db.marketRateSamples
  );

  const aiRoundNumber = rounds.filter((r) => r.actor === "AI").length + 1;
  let recommendation = generateCounterOffer({ rate, brandOfferAmount, roundNumber: aiRoundNumber });

  const brand = deal.brandId ? db.brands.find((b) => b.id === deal.brandId) : undefined;
  recommendation = await polishNegotiationCopy(recommendation, {
    creatorName: profile.displayName,
    brandName: brand?.name ?? deal.brandNameFreeText ?? "the brand",
    platform: deal.platform,
    contentType: deal.contentType,
  });

  const round = {
    id: id(),
    dealId: deal.id,
    roundNumber: rounds.length + 1,
    actor: "AI" as const,
    amount: recommendation.suggestedCounterAmount,
    message: recommendation.recommendation,
    rationale: recommendation.rationale,
    confidenceScore: recommendation.confidenceScore,
    createdAt: now(),
  };
  db.negotiationRounds.push(round);

  deal.status = "COUNTERED";
  deal.updatedAt = now();
  sub.aiNegotiationsUsedThisPeriod += 1;
  persist();

  res.status(201).json({ round, rate, recommendation });
});

const statusSchema = z.object({
  status: z.enum(["ACCEPTED", "DECLINED", "COMPLETED"]),
});

// Whenever a deal closes at a real dollar amount, capture it as a market
// data point (see MarketRateSample in types.ts) so future rate estimates
// for other creators in the same platform/niche get better over time — see
// lib/negotiation.ts's marketAdjustedBaseRate() for how these get used, and
// routes/market.ts for the tier-gated rate-lookup features built on top.
// Upserts by dealId so a deal that goes ACCEPTED then later COMPLETED (at
// the same or a renegotiated amount) doesn't get double-counted.
function recordMarketRateSample(deal: Deal, profile: CreatorProfile) {
  if (!deal.currentAmount || deal.currentAmount <= 0) return;
  const account =
    db.socialAccounts.find((a) => a.creatorProfileId === profile.id && a.platform === deal.platform) ??
    db.socialAccounts.find((a) => a.creatorProfileId === profile.id);
  if (!account || account.followers <= 0) return;

  const ratePer1000 = deal.currentAmount / (account.followers / 1000);
  const sample = {
    id: id(),
    dealId: deal.id,
    platform: deal.platform,
    contentType: deal.contentType,
    niche: profile.niche,
    followers: account.followers,
    engagementRate: account.engagementRate,
    isAthlete: profile.isAthlete,
    finalAmount: deal.currentAmount,
    ratePer1000,
    createdAt: now(),
  };

  const existingIndex = db.marketRateSamples.findIndex((s) => s.dealId === deal.id);
  if (existingIndex >= 0) db.marketRateSamples[existingIndex] = sample;
  else db.marketRateSamples.push(sample);
}

router.post("/:id/status", (req: AuthedRequest, res) => {
  const result = getDealOwned(req, String(req.params.id));
  if ("error" in result) return res.status(result.error).json({ error: result.msg });
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  result.deal.status = parsed.data.status;
  result.deal.updatedAt = now();

  if (parsed.data.status === "ACCEPTED" || parsed.data.status === "COMPLETED") {
    recordMarketRateSample(result.deal, result.profile);
  }

  persist();
  res.json({ deal: result.deal });
});

export default router;
