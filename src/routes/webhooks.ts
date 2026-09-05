import { Router } from "express";
import { db, persist, now } from "../lib/store";
import { entitlementsToTier, GRANTING_EVENTS, REVOKING_EVENTS, FREE_TIER } from "../lib/entitlements";
import { Tier } from "../types";

const router = Router();

/**
 * RevenueCat webhook — the ONLY thing that may change a paid tier.
 *
 * Subscription state deliberately never comes from the app. A client can be
 * tampered with, so "I bought Pro" arriving from a phone is a claim, not a
 * fact. RevenueCat validates the receipt with Apple and then calls us here, so
 * the tier in our database always traces back to a real, Apple-verified
 * purchase.
 *
 * Auth: RevenueCat sends the value configured in its dashboard as the
 * Authorization header. We compare it to REVENUECAT_WEBHOOK_SECRET. Without
 * that env var set the endpoint refuses everything rather than defaulting to
 * open — an unauthenticated version of this route would let anyone on the
 * internet grant themselves a paid tier.
 */
router.post("/revenuecat", (req, res) => {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[revenuecat] REVENUECAT_WEBHOOK_SECRET is not set — rejecting webhook.");
    return res.status(503).json({ error: "Webhook not configured" });
  }
  if (req.headers.authorization !== expected) {
    console.warn("[revenuecat] Rejected webhook with bad Authorization header.");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const event = req.body?.event;
  if (!event || typeof event.type !== "string") {
    return res.status(400).json({ error: "Malformed event" });
  }

  // app_user_id is our own user id: the app calls Purchases.logIn(userId) at
  // sign-in, so RevenueCat identifies subscribers by the same id we do.
  const userId: string | undefined = event.app_user_id;
  if (!userId) return res.status(400).json({ error: "Missing app_user_id" });

  const sub = db.subscriptions.find((s) => s.userId === userId);
  if (!sub) {
    // 200, not 404: the account was probably deleted. Returning an error makes
    // RevenueCat retry this event for days over something that will never
    // succeed.
    console.warn(`[revenuecat] ${event.type} for unknown user ${userId} — acknowledging without action.`);
    return res.json({ ok: true, applied: false, reason: "no such subscription" });
  }

  let newTier: Tier | null = null;

  if (GRANTING_EVENTS.has(event.type)) {
    const ids: string[] = Array.isArray(event.entitlement_ids)
      ? event.entitlement_ids
      : event.entitlement_id
        ? [event.entitlement_id]
        : [];
    newTier = entitlementsToTier(ids);
  } else if (REVOKING_EVENTS.has(event.type)) {
    newTier = FREE_TIER;
  } else {
    // Billing issues, transfers, and test events land here. They don't change
    // access on their own — Apple retries payment for days before an
    // EXPIRATION, and cutting someone off at the first failed charge would be
    // wrong.
    console.log(`[revenuecat] ${event.type} for ${userId} — no tier change.`);
    return res.json({ ok: true, applied: false, reason: "event does not change access" });
  }

  const previous = sub.tier;
  sub.tier = newTier;
  sub.status = newTier === FREE_TIER ? "canceled" : "active";
  sub.updatedAt = now();

  // period_type "TRIAL" means an introductory offer, which is a real
  // entitlement but shouldn't read as a settled paying customer.
  if (event.period_type === "TRIAL") sub.status = "trialing";

  if (typeof event.expiration_at_ms === "number") {
    sub.currentPeriodEnd = new Date(event.expiration_at_ms).toISOString();
  }

  persist();
  console.log(`[revenuecat] ${event.type}: ${userId} ${previous} -> ${sub.tier} (${sub.status})`);
  res.json({ ok: true, applied: true, tier: sub.tier });
});

export default router;
