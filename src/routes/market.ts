import { Router } from "express";
import { db } from "../lib/store";
import { AuthedRequest, requireAuth, requireTier } from "../middleware/auth";
import { median, MIN_SAMPLES_FOR_MARKET_ADJUSTMENT } from "../lib/negotiation";
import { ContentType, MarketRateSample, Platform } from "../types";

// Turns the closed-deal data captured in routes/deals.ts (see
// recordMarketRateSample there, and MarketRateSample in types.ts) into the
// two features tiers.ts has been promising all along — "Market rate lookup
// by niche/platform" (Pro+) and "Market intelligence dashboard" (Advanced+)
// — with real numbers instead of a description nobody could act on.
const router = Router();
router.use(requireAuth);

function summarize(samples: MarketRateSample[]) {
  const rates = samples.map((s) => s.ratePer1000);
  return {
    sampleCount: samples.length,
    medianRatePer1000: samples.length ? round2(median(rates)) : null,
    lowRatePer1000: samples.length ? round2(Math.min(...rates)) : null,
    highRatePer1000: samples.length ? round2(Math.max(...rates)) : null,
    isLiveData: samples.length >= MIN_SAMPLES_FOR_MARKET_ADJUSTMENT,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

const PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "X", "TWITCH", "PODCAST"];
const CONTENT_TYPES: ContentType[] = ["POST", "STORY", "REEL", "VIDEO", "BUNDLE", "APPEARANCE"];

// GET /market/rates?platform=INSTAGRAM&contentType=REEL&niche=fitness
// A single lookup: "what's the going rate here, based on real Fair Share
// deals?" Pro+ (matches tiers.ts's "Market rate lookup by niche/platform").
router.get("/rates", requireTier("PRO"), (req: AuthedRequest, res) => {
  const platform = req.query.platform as string | undefined;
  const contentType = req.query.contentType as string | undefined;
  const niche = req.query.niche as string | undefined;

  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return res.status(400).json({ error: `platform is required and must be one of: ${PLATFORMS.join(", ")}` });
  }
  if (contentType && !CONTENT_TYPES.includes(contentType as ContentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${CONTENT_TYPES.join(", ")}` });
  }

  let samples = db.marketRateSamples.filter((s) => s.platform === platform);
  if (contentType) samples = samples.filter((s) => s.contentType === contentType);
  const nicheKey = niche?.trim().toLowerCase();
  const nicheSamples = nicheKey ? samples.filter((s) => s.niche.trim().toLowerCase() === nicheKey) : samples;

  // Prefer the niche-specific view if it has enough data on its own;
  // otherwise fall back to the broader platform(+content type) view so the
  // response is still useful rather than empty — same broadening logic the
  // negotiation engine itself uses (see marketAdjustedBaseRate).
  const useNicheView = nicheKey && nicheSamples.length >= MIN_SAMPLES_FOR_MARKET_ADJUSTMENT;
  const summary = summarize(useNicheView ? nicheSamples : samples);

  res.json({
    platform,
    contentType: contentType ?? null,
    niche: niche ?? null,
    scope: useNicheView ? "platform+content+niche" : contentType ? "platform+content" : "platform",
    ...summary,
    note: summary.isLiveData
      ? `Based on ${summary.sampleCount} real closed deals on Fair Share.`
      : `Not enough closed-deal data yet (${summary.sampleCount}/${MIN_SAMPLES_FOR_MARKET_ADJUSTMENT} needed) — AI rate estimates are currently using the industry-benchmark table instead.`,
  });
});

// GET /market/dashboard
// The broader view across every platform+niche combination with any real
// data yet, sorted by how much data backs each one. Advanced+ (matches
// tiers.ts's "Market intelligence dashboard").
router.get("/dashboard", requireTier("ADVANCED"), (_req: AuthedRequest, res) => {
  const groups = new Map<string, MarketRateSample[]>();
  for (const s of db.marketRateSamples) {
    const key = `${s.platform}::${s.contentType}::${s.niche.trim().toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }

  const rows = Array.from(groups.entries())
    .map(([key, samples]) => {
      const [platform, contentType, niche] = key.split("::");
      return { platform, contentType, niche, ...summarize(samples) };
    })
    .filter((row) => row.isLiveData)
    .sort((a, b) => b.sampleCount - a.sampleCount);

  res.json({
    segments: rows,
    totalClosedDeals: db.marketRateSamples.length,
    note:
      rows.length === 0
        ? `No platform/content/niche combination has ${MIN_SAMPLES_FOR_MARKET_ADJUSTMENT}+ closed deals yet — this fills in automatically as more deals on Fair Share are marked Accepted or Completed.`
        : undefined,
  });
});

export default router;
