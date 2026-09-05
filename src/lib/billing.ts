import { Tier } from "../types";
import { TIERS } from "./tiers";

/**
 * Billing abstraction.
 *
 * Apple guideline 3.1.1: on iOS, any subscription unlocking in-app digital
 * features MUST be sold through Apple's In-App Purchase, not a card taken in
 * our own UI. So we don't run a checkout at all — the app presents Apple's
 * purchase sheet via RevenueCat, Apple takes the money, RevenueCat validates
 * the receipt, and our server hears about it on the webhook in
 * routes/webhooks.ts. This module only reports which mode we're in.
 *
 * (Stripe would still be the right tool for the escrow/payout side — money
 * moving between a brand and a creator for real-world work is not "unlocking
 * app content" and is outside Apple's rule.)
 *
 * Modes:
 *   APPLE_IAP  REVENUECAT_WEBHOOK_SECRET is set. Tiers change only via
 *              Apple-verified purchases. Self-serve tier switching is refused.
 *   MOCK       No webhook secret. Pre-launch/dev only: tiers can be set
 *              directly so the app can be built and tested without a store.
 */
export function billingMode(): "MOCK" | "APPLE_IAP" {
  return process.env.REVENUECAT_WEBHOOK_SECRET ? "APPLE_IAP" : "MOCK";
}

/** True once real payments are live — self-serve tier changes must be refused. */
export function paidTiersAreLive(): boolean {
  return billingMode() === "APPLE_IAP";
}

export interface CheckoutResult {
  mode: "MOCK" | "APPLE_IAP";
  message: string;
}

export async function startCheckout(_userId: string, tier: Tier): Promise<CheckoutResult> {
  const def = TIERS[tier];
  if (paidTiersAreLive()) {
    return {
      mode: "APPLE_IAP",
      message: `${def.name} is purchased in the app through Apple. There is no server-side checkout.`,
    };
  }
  return {
    mode: "MOCK",
    message: `Pre-launch mode: no store configured, so ${def.name} is granted directly without a charge.`,
  };
}
