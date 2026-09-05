import { ContentType, MarketRateSample, Platform } from "../types";

/**
 * Fair Share AI negotiation engine.
 *
 * This is the core product feature: given a creator's audience + a brand's
 * offer, tell the creator (a) what the deal is actually worth, and
 * (b) exactly what to say back.
 *
 * The math here is a transparent, documented heuristic built from widely
 * cited creator-economy rate-of-thumb benchmarks (cost per 1,000 followers,
 * "CPM" style), NOT a live market-data feed. It is deliberately deterministic
 * so it can be unit-tested with no network access. Swap `basePlatformRates`
 * for a real market-data provider (e.g. an aggregated rate-card API) when
 * one is wired up — the rest of the engine (engagement/niche adjustment,
 * concession curve, confidence scoring) does not need to change.
 */

// Base rate in USD per 1,000 followers, at "average" engagement, for a
// creator of unspecified niche. Source: blended industry rules of thumb
// (Influencer Marketing Hub / Later.com published benchmarks, 2024-2025).
const basePlatformRates: Record<Platform, Partial<Record<ContentType, number>>> = {
  INSTAGRAM: { POST: 10, STORY: 5, REEL: 14, BUNDLE: 25, VIDEO: 14, APPEARANCE: 20 },
  TIKTOK: { VIDEO: 15, BUNDLE: 25, POST: 15, APPEARANCE: 20 },
  YOUTUBE: { VIDEO: 30, BUNDLE: 40, APPEARANCE: 35 },
  FACEBOOK: { POST: 8, VIDEO: 12, STORY: 4, REEL: 10, BUNDLE: 18, APPEARANCE: 16 },
  X: { POST: 6, BUNDLE: 12, APPEARANCE: 10 },
  TWITCH: { APPEARANCE: 20, BUNDLE: 28 },
  PODCAST: { APPEARANCE: 18, BUNDLE: 26 },
};

// Average engagement rate (%) assumed per platform, used to normalize a
// creator's actual engagement into a multiplier.
const platformAverageEngagement: Record<Platform, number> = {
  INSTAGRAM: 2.0,
  TIKTOK: 5.0,
  YOUTUBE: 3.0,
  // Facebook engagement runs far lower than the other platforms, so the
  // baseline it is measured against is lower too — otherwise every Facebook
  // creator would be scored as underperforming.
  FACEBOOK: 1.0,
  X: 1.5,
  TWITCH: 4.0,
  PODCAST: 3.0,
};

// Niches that command a premium or discount vs. baseline, based on typical
// brand marketing budgets in that vertical.
const nicheMultipliers: Record<string, number> = {
  finance: 1.45,
  tech: 1.4,
  software: 1.4,
  beauty: 1.2,
  fashion: 1.2,
  fitness: 1.15,
  sports: 1.15,
  gaming: 1.1,
  food: 1.05,
  parenting: 1.05,
  family: 1.05,
  lifestyle: 1.0,
  travel: 1.05,
  comedy: 0.9,
  entertainment: 0.9,
};

function nicheMultiplier(niche: string | undefined | null): number {
  if (!niche) return 1.0;
  const key = niche.trim().toLowerCase();
  return nicheMultipliers[key] ?? 1.0;
}

function engagementMultiplier(platform: Platform, engagementRate: number): number {
  const avg = platformAverageEngagement[platform] ?? 2.5;
  if (!engagementRate || engagementRate <= 0) return 0.7; // no/zero engagement data is a red flag
  const ratio = engagementRate / avg;
  return clamp(ratio, 0.5, 2.5);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface RateInput {
  platform: Platform;
  contentType: ContentType;
  followers: number;
  engagementRate: number;
  niche?: string | null;
}

export interface RateEstimate {
  suggestedRate: number; // "fair market" target, rounded to nearest $5
  low: number; // conservative floor of a reasonable range
  high: number; // ambitious ceiling of a reasonable range
  basis: {
    baseRatePer1000: number; // what was actually used (benchmark, or blended with real deal data)
    staticBenchmarkRatePer1000: number; // the un-blended industry benchmark, for comparison
    engagementMultiplier: number;
    nicheMultiplier: number;
    followers: number;
    marketSampleCount: number; // how many real closed deals informed baseRatePer1000
    marketDataApplied: boolean; // false if there weren't enough real samples to move the number
  };
}

// --- Real-deal-data blending -------------------------------------------
//
// estimateFairRate() starts from the static industry-benchmark table above,
// then nudges it toward what Fair Share's own users have actually closed
// deals at, once there's enough real data to trust. This is what makes
// pricing improve over time instead of being frozen at the 2024-2025
// benchmark figures forever — see MarketRateSample in types.ts for where
// the underlying data point comes from (recorded automatically whenever a
// deal is marked ACCEPTED/COMPLETED — see routes/deals.ts) and
// routes/market.ts for the tier-gated lookup/dashboard built on the same
// data.
//
// Deliberately conservative on purpose: a handful of one-off deals
// (an unusually generous or lowball negotiation) shouldn't swing everyone's
// estimate, so (a) a minimum sample size gates whether real data is used at
// all, (b) real data is blended in gradually as more samples accumulate
// rather than fully replacing the benchmark, and (c) the median (not the
// mean) is used so a single outlier deal can't dominate.
export const MIN_SAMPLES_FOR_MARKET_ADJUSTMENT = 3;
const MAX_MARKET_WEIGHT = 0.6; // real data never fully overrides the benchmark
const SAMPLES_FOR_FULL_WEIGHT = 20; // sample count at which MAX_MARKET_WEIGHT is reached

export function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface MarketAdjustment {
  ratePer1000: number;
  sampleCount: number;
  matchedOn: "platform+content+niche" | "platform+content" | "platform" | "none";
}

/**
 * Blends the static per-platform/content-type benchmark rate with real
 * closed-deal data, preferring the closest match (platform + content type +
 * niche) and progressively broadening the match (dropping niche, then
 * content type) if there isn't enough data at the more specific level yet.
 */
export function marketAdjustedBaseRate(
  staticRatePer1000: number,
  platform: Platform,
  contentType: ContentType,
  niche: string | undefined | null,
  samples: MarketRateSample[]
): MarketAdjustment {
  const nicheKey = (niche || "").trim().toLowerCase();

  const byPlatform = samples.filter((s) => s.platform === platform);
  const byPlatformAndContent = byPlatform.filter((s) => s.contentType === contentType);
  const exact = byPlatformAndContent.filter((s) => s.niche.trim().toLowerCase() === nicheKey);

  let matched: MarketRateSample[];
  let matchedOn: MarketAdjustment["matchedOn"];
  if (nicheKey && exact.length >= MIN_SAMPLES_FOR_MARKET_ADJUSTMENT) {
    matched = exact;
    matchedOn = "platform+content+niche";
  } else if (byPlatformAndContent.length >= MIN_SAMPLES_FOR_MARKET_ADJUSTMENT) {
    matched = byPlatformAndContent;
    matchedOn = "platform+content";
  } else if (byPlatform.length >= MIN_SAMPLES_FOR_MARKET_ADJUSTMENT) {
    matched = byPlatform;
    matchedOn = "platform";
  } else {
    return { ratePer1000: staticRatePer1000, sampleCount: 0, matchedOn: "none" };
  }

  const marketRate = median(matched.map((s) => s.ratePer1000));
  const weight = clamp(matched.length / SAMPLES_FOR_FULL_WEIGHT, 0, MAX_MARKET_WEIGHT);
  const blended = staticRatePer1000 * (1 - weight) + marketRate * weight;

  return { ratePer1000: blended, sampleCount: matched.length, matchedOn };
}

export function estimateFairRate(input: RateInput, marketSamples: MarketRateSample[] = []): RateEstimate {
  const rateTable = basePlatformRates[input.platform] || {};
  const staticBenchmarkRatePer1000 =
    rateTable[input.contentType] ?? Object.values(rateTable)[0] ?? 8;

  const marketAdj = marketAdjustedBaseRate(
    staticBenchmarkRatePer1000,
    input.platform,
    input.contentType,
    input.niche,
    marketSamples
  );
  const baseRatePer1000 = marketAdj.ratePer1000;

  const engMult = engagementMultiplier(input.platform, input.engagementRate);
  const nMult = nicheMultiplier(input.niche);

  const raw = (input.followers / 1000) * baseRatePer1000 * engMult * nMult;
  const suggestedRate = roundTo(raw, 5);

  return {
    suggestedRate,
    low: roundTo(raw * 0.8, 5),
    high: roundTo(raw * 1.25, 5),
    basis: {
      baseRatePer1000,
      staticBenchmarkRatePer1000,
      engagementMultiplier: round2(engMult),
      nicheMultiplier: nMult,
      followers: input.followers,
      marketSampleCount: marketAdj.sampleCount,
      marketDataApplied: marketAdj.matchedOn !== "none",
    },
  };
}

function roundTo(v: number, nearest: number): number {
  return Math.max(nearest, Math.round(v / nearest) * nearest);
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type CounterOfferRecommendation = "ACCEPT" | "COUNTER" | "COUNTER_FIRM" | "DECLINE_OR_ADD_SCOPE";

export interface CounterOfferInput {
  rate: RateEstimate;
  brandOfferAmount: number;
  roundNumber: number; // 1 = first AI response to the brand's initial offer
}

export interface CounterOfferResult {
  recommendation: CounterOfferRecommendation;
  suggestedCounterAmount: number;
  confidenceScore: number; // 0-1
  rationale: string;
  talkingPoints: string[];
}

/**
 * Given the fair-market estimate and what the brand actually offered,
 * produce a recommendation + a specific number to counter with, plus plain-
 * English talking points the creator can literally send to the brand.
 */
export function generateCounterOffer(input: CounterOfferInput): CounterOfferResult {
  const { rate, brandOfferAmount, roundNumber } = input;
  const target = rate.suggestedRate;
  const ratio = target > 0 ? brandOfferAmount / target : 0;

  // Concession curve: our opening ask anchors above target, then eases
  // toward (but not below) a floor as rounds progress, mirroring how a
  // human negotiator would soften without racing to the bottom.
  const anchorMultiplier = clamp(1.15 - (roundNumber - 1) * 0.04, 1.0, 1.15);
  const floorMultiplier = 0.85;

  let recommendation: CounterOfferRecommendation;
  let suggestedCounterAmount: number;
  let rationale: string;

  if (ratio >= 1.0) {
    recommendation = "ACCEPT";
    suggestedCounterAmount = brandOfferAmount;
    rationale = `The brand's offer of $${brandOfferAmount.toLocaleString()} already meets or beats the estimated fair market rate of $${target.toLocaleString()} for this deal. Accepting is reasonable; countering from here risks the deal for little upside.`;
  } else if (ratio >= 0.7) {
    recommendation = "COUNTER";
    suggestedCounterAmount = roundTo(target * anchorMultiplier, 5);
    rationale = `The offer of $${brandOfferAmount.toLocaleString()} is ${Math.round((1 - ratio) * 100)}% below the estimated fair rate of $${target.toLocaleString()}. A counter of $${suggestedCounterAmount.toLocaleString()} is a normal, professional opening ask that leaves room to settle close to fair value.`;
  } else {
    recommendation = "COUNTER_FIRM";
    suggestedCounterAmount = roundTo(target * anchorMultiplier, 5);
    rationale = `The offer of $${brandOfferAmount.toLocaleString()} is significantly below (more than 30% under) the estimated fair rate of $${target.toLocaleString()} for an account this size and engagement level. Recommend holding firm near $${suggestedCounterAmount.toLocaleString()} rather than meeting in the middle — this offer looks like a lowball opening bid, not a good-faith starting point.`;
  }

  // If we're deep into a negotiation (several rounds) and still above the
  // floor, but the brand clearly won't move, flag the alternative path of
  // trading scope instead of price.
  if (recommendation !== "ACCEPT" && roundNumber >= 3 && ratio < 0.9) {
    recommendation = "DECLINE_OR_ADD_SCOPE";
    rationale += ` After ${roundNumber} rounds without meeting near fair value, consider either walking away or keeping this price but reducing deliverables (e.g. one Story instead of a Story + feed post) so the rate-per-deliverable stays fair.`;
  }

  const floor = roundTo(target * floorMultiplier, 5);
  const confidenceScore = computeConfidence(rate);

  const talkingPoints = buildTalkingPoints({
    recommendation,
    target,
    brandOfferAmount,
    suggestedCounterAmount,
    floor,
  });

  return { recommendation, suggestedCounterAmount, confidenceScore, rationale, talkingPoints };
}

function computeConfidence(rate: RateEstimate): number {
  // Confidence is lower for very small audiences (thin data), and for
  // engagement multipliers at the extreme ends (likely low-quality
  // engagement data or an outlier account).
  let c = 0.8;
  if (rate.basis.followers < 1000) c -= 0.25;
  else if (rate.basis.followers < 5000) c -= 0.1;
  if (rate.basis.engagementMultiplier <= 0.6 || rate.basis.engagementMultiplier >= 2.3) c -= 0.15;
  return round2(clamp(c, 0.2, 0.95));
}

function buildTalkingPoints(args: {
  recommendation: CounterOfferRecommendation;
  target: number;
  brandOfferAmount: number;
  suggestedCounterAmount: number;
  floor: number;
}): string[] {
  const { recommendation, target, brandOfferAmount, suggestedCounterAmount, floor } = args;
  if (recommendation === "ACCEPT") {
    return [
      "Thank the brand for the offer and confirm deliverables/timeline in writing.",
      "Ask for a written contract or IO before posting anything.",
      `Confirm payment terms (recommend: 50% upfront, 50% on delivery, or full upfront).`,
    ];
  }
  return [
    `Open with: "Thanks for reaching out! Based on my current audience and engagement, my rate for this is $${suggestedCounterAmount.toLocaleString()}."`,
    `If they push back, you can flex down toward $${floor.toLocaleString()} but that's your floor for this scope — below that, reduce deliverables instead of price.`,
    `Anchor to data: mention your average engagement rate and that $${target.toLocaleString()} reflects current market rate for your niche and platform.`,
    "Always get deliverables, usage rights, and payment terms in writing before starting content.",
  ];
}
