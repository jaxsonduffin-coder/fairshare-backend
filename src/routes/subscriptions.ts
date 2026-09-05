import { Router } from "express";
import { z } from "zod";
import { db, persist } from "../lib/store";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { listTiers, TIERS } from "../lib/tiers";
import { startCheckout, billingMode, paidTiersAreLive } from "../lib/billing";
import { Tier } from "../types";

const router = Router();

router.get("/tiers", (_req, res) => {
  res.json({ tiers: listTiers(), billingMode: billingMode() });
});

router.use(requireAuth);

router.get("/me", (req: AuthedRequest, res) => {
  const sub = db.subscriptions.find((s) => s.userId === req.userId);
  if (!sub) return res.status(404).json({ error: "No subscription found" });
  res.json({ subscription: sub, tierDefinition: TIERS[sub.tier] });
});

const changeSchema = z.object({
  tier: z.enum(["BASIC", "PRO", "ADVANCED", "ENTERPRISE", "WHITE_LABEL"]),
});

// Pre-launch (MOCK) this immediately activates the requested tier so the app
// can be built and tested without a store.
//
// Once real payments are live this MUST refuse: a client asking for a tier is
// a claim, not a payment, and leaving this open would let anyone grant
// themselves a paid plan with one HTTP request. Paid tiers then change only
// through the Apple-verified RevenueCat webhook (routes/webhooks.ts). The
// switch is automatic — it follows REVENUECAT_WEBHOOK_SECRET being set — so
// there is no window where payments are live and this endpoint is still open.
router.post("/change", async (req: AuthedRequest, res) => {
  if (paidTiersAreLive()) {
    return res.status(409).json({
      error: "Plans are purchased through Apple in the app. Open the Plan tab to subscribe or restore a purchase.",
    });
  }

  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const targetTier = parsed.data.tier as Tier;

  const sub = db.subscriptions.find((s) => s.userId === req.userId);
  if (!sub) return res.status(404).json({ error: "No subscription found" });

  const checkout = await startCheckout(req.userId!, targetTier);

  if (checkout.mode === "MOCK") {
    sub.tier = targetTier;
    sub.status = "active";
    sub.updatedAt = new Date().toISOString();
    persist();
    return res.json({ subscription: sub, checkout });
  }

  res.json({ subscription: sub, checkout });
});

export default router;
