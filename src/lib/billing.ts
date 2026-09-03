import { Tier } from "../types";
import { TIERS } from "./tiers";

/**
 * Billing abstraction. In MOCK mode (default — no STRIPE_SECRET_KEY set),
 * subscription state is simulated entirely in the local store so the whole
 * app (tier gating, paywall, upgrade/downgrade) can be built and tested
 * without a Stripe account. Once STRIPE_SECRET_KEY is set, real Checkout
 * Sessions / subscriptions would replace the mock branch below.
 *
 * IMPORTANT (Apple App Store guideline 3.1.1): on iOS, any subscription that
 * unlocks in-app digital features/content MUST be sold through Apple's
 * In-App Purchase (StoreKit), not Stripe directly — see APP_STORE_READINESS.md.
 * Stripe (via Stripe Connect) is fine for the escrow/payout side, i.e. money
 * actually moving between a brand and a creator for a real-world service —
 * that is not "unlocking app content" in Apple's sense.
 */

export function billingMode(): "MOCK" | "STRIPE" {
  return process.env.STRIPE_SECRET_KEY ? "STRIPE" : "MOCK";
}

export interface CheckoutResult {
  mode: "MOCK" | "STRIPE";
  checkoutUrl?: string;
  message: string;
}

export async function startCheckout(userId: string, tier: Tier): Promise<CheckoutResult> {
  const def = TIERS[tier];
  if (billingMode() === "MOCK") {
    return {
      mode: "MOCK",
      message: `Mock billing mode: no Stripe key configured, so no real charge occurs. In production this would open Stripe Checkout for ${def.name} ($${def.priceMonthlyUsd}/mo).`,
    };
  }
  // Real integration point: create a Stripe Checkout Session here using the
  // Stripe Node SDK once STRIPE_SECRET_KEY is present, then return its url.
  return {
    mode: "STRIPE",
    checkoutUrl: "https://checkout.stripe.com/pay/PLACEHOLDER",
    message: "Stripe key detected — wire the real Checkout Session creation call here.",
  };
}
