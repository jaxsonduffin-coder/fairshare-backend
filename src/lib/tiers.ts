import { Tier } from "../types";

export interface TierDefinition {
  tier: Tier;
  name: string;
  priceMonthlyUsd: number;
  maxActiveDeals: number | null; // null = unlimited
  aiNegotiationsPerMonth: number | null; // null = unlimited
  features: string[];
  unlocksBrandOutreach: boolean;
  unlocksAthleteMatching: boolean;
  unlocksAgencyWhiteLabel: boolean;
}

// Single source of truth for pricing + gating. Changing a limit here changes
// it everywhere (API gating, app paywall copy, tests).
export const TIERS: Record<Tier, TierDefinition> = {
  BASIC: {
    tier: "BASIC",
    name: "Starter",
    priceMonthlyUsd: 9.99,
    maxActiveDeals: 5,
    aiNegotiationsPerMonth: 5,
    features: [
      "Up to 5 active brand deals",
      "5 AI counter-offers a month, with the reasoning behind each",
      "A ready-to-send reply drafted for every counter-offer",
      "Full negotiation history per deal",
      "Email support",
    ],
    unlocksBrandOutreach: false,
    unlocksAthleteMatching: false,
    unlocksAgencyWhiteLabel: false,
  },
  PRO: {
    tier: "PRO",
    name: "Pro",
    priceMonthlyUsd: 19.99,
    maxActiveDeals: 20,
    aiNegotiationsPerMonth: null,
    features: [
      "Everything in Starter",
      "Up to 20 active deals",
      "Unlimited AI counter-offers",
      "Market rate lookup by niche and platform",
      "Cost-per-view analysis on every offer",
    ],
    unlocksBrandOutreach: false,
    unlocksAthleteMatching: false,
    unlocksAgencyWhiteLabel: false,
  },
  ADVANCED: {
    tier: "ADVANCED",
    name: "Advanced",
    priceMonthlyUsd: 39.99,
    maxActiveDeals: null,
    aiNegotiationsPerMonth: null,
    features: [
      "Everything in Pro",
      "Unlimited active deals",
      "Market intelligence dashboard",
      "NIL pricing built for college athletes",
      "Priority support",
    ],
    unlocksBrandOutreach: true,
    unlocksAthleteMatching: true,
    unlocksAgencyWhiteLabel: false,
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    name: "Creator Enterprise",
    priceMonthlyUsd: 150,
    maxActiveDeals: null,
    aiNegotiationsPerMonth: null,
    features: [
      "Everything in Advanced",
      "Personal account-manager notes & concierge flags",
      "Team seats (up to 3 collaborators)",
      "Advanced analytics & seasonal forecasting",
      "Priority support (24h)",
    ],
    unlocksBrandOutreach: true,
    unlocksAthleteMatching: true,
    unlocksAgencyWhiteLabel: false,
  },
  WHITE_LABEL: {
    tier: "WHITE_LABEL",
    name: "Agency White Label",
    priceMonthlyUsd: 999,
    maxActiveDeals: null,
    aiNegotiationsPerMonth: null,
    features: [
      "Everything in Enterprise, for unlimited managed clients",
      "Your own branding (logo, color) across client dashboards",
      "Manage many creator/athlete clients from one agency account",
      "API access",
      "Dedicated onboarding",
    ],
    unlocksBrandOutreach: true,
    unlocksAthleteMatching: true,
    unlocksAgencyWhiteLabel: true,
  },
};

// The tiers actually offered for sale in the app, in ladder order.
//
// ENTERPRISE and WHITE_LABEL are deliberately excluded: they are business
// sales, not something someone taps a phone to buy, and Apple would require
// each to exist as its own approved in-app purchase product. Their entries
// stay in TIERS so that any account already on one keeps working and
// TIERS[tier] never returns undefined.
const SELLABLE_TIERS: Tier[] = ["BASIC", "PRO", "ADVANCED"];

export function listTiers(): TierDefinition[] {
  return SELLABLE_TIERS.map((t) => TIERS[t]);
}
