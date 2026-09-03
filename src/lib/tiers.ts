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
    name: "Creator Basic",
    priceMonthlyUsd: 9.99,
    maxActiveDeals: 5,
    aiNegotiationsPerMonth: 3,
    features: [
      "Manage up to 5 active brand deals",
      "Contract & pricing templates",
      "3 AI counter-offer suggestions / month",
      "Basic deal tracker",
      "Email support",
    ],
    unlocksBrandOutreach: false,
    unlocksAthleteMatching: false,
    unlocksAgencyWhiteLabel: false,
  },
  PRO: {
    tier: "PRO",
    name: "Creator Pro",
    priceMonthlyUsd: 24.99,
    maxActiveDeals: 20,
    aiNegotiationsPerMonth: null,
    features: [
      "Manage up to 20 active deals",
      "Unlimited AI negotiator (counter-offers + rationale)",
      "Custom rate card builder",
      "Market rate lookup by niche/platform",
      "Automated deal reminders",
    ],
    unlocksBrandOutreach: false,
    unlocksAthleteMatching: false,
    unlocksAgencyWhiteLabel: false,
  },
  ADVANCED: {
    tier: "ADVANCED",
    name: "Creator Advanced",
    priceMonthlyUsd: 49.99,
    maxActiveDeals: null,
    aiNegotiationsPerMonth: null,
    features: [
      "Everything in Pro",
      "Unlimited active deals",
      "Brand directory + in-app outreach email",
      "Athlete brand-matching (college athletes)",
      "Market intelligence dashboard",
      "Priority negotiation confidence scoring",
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

export function listTiers(): TierDefinition[] {
  return Object.values(TIERS);
}
