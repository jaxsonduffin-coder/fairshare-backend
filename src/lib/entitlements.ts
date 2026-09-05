import { Tier } from "../types";

/**
 * Maps a RevenueCat entitlement identifier onto one of our tiers.
 *
 * Why entitlements rather than product ids: a tier can be sold as more than
 * one product (monthly and annual, a promotional price, a grandfathered SKU),
 * and Apple issues a different product id for each. Entitlements are the
 * stable name for "what this person is allowed to do", so the mapping below
 * stays correct when pricing or SKUs change.
 *
 * Keep these identifiers identical to the entitlement identifiers configured
 * in RevenueCat — a typo here silently downgrades paying customers to free,
 * so entitlementToTier() logs anything it does not recognise instead of
 * quietly returning the free tier.
 */
const ENTITLEMENT_TO_TIER: Record<string, Tier> = {
  pro: "PRO",
  advanced: "ADVANCED",
};

/** The tier an account has when it holds no paid entitlement. */
export const FREE_TIER: Tier = "BASIC";

/**
 * Picks the tier for a set of active entitlement identifiers. A subscriber
 * can hold more than one at once (an upgrade lands before the old one lapses,
 * or a promo grants a second), so this returns the highest rather than the
 * first — never downgrade someone who legitimately holds two.
 */
export function entitlementsToTier(activeEntitlementIds: string[]): Tier {
  const ORDER: Tier[] = ["BASIC", "PRO", "ADVANCED", "ENTERPRISE", "WHITE_LABEL"];
  let best: Tier = FREE_TIER;

  for (const id of activeEntitlementIds) {
    const tier = ENTITLEMENT_TO_TIER[id];
    if (!tier) {
      // Unknown entitlement: don't guess. Log loudly — this usually means an
      // entitlement was added in RevenueCat without adding it here.
      console.warn(`[entitlements] Unrecognised entitlement "${id}" — ignoring. Add it to ENTITLEMENT_TO_TIER.`);
      continue;
    }
    if (ORDER.indexOf(tier) > ORDER.indexOf(best)) best = tier;
  }

  return best;
}

/**
 * RevenueCat event types that mean "this person currently has access".
 * INITIAL_PURCHASE/RENEWAL/UNCANCELLATION are obvious; PRODUCT_CHANGE fires on
 * an upgrade or downgrade and carries the new entitlements.
 *
 * Deliberately NOT here: CANCELLATION. Cancelling only stops the next renewal —
 * Apple still grants access until the period ends, and RevenueCat keeps the
 * entitlement active until then. Treating CANCELLATION as "revoke now" would
 * cut off people who already paid for the rest of the month, which is both
 * wrong and a refund request waiting to happen. EXPIRATION is the event that
 * actually ends access.
 */
export const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

/** Events that end access immediately. */
export const REVOKING_EVENTS = new Set([
  "EXPIRATION",
  "REFUND",
  "REFUND_REVERSED",
  "SUBSCRIPTION_PAUSED",
]);
