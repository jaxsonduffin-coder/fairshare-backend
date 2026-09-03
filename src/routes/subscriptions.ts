import { Router } from "express";
import { z } from "zod";
import { db, persist } from "../lib/store";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { listTiers, TIERS } from "../lib/tiers";
import { startCheckout, billingMode } from "../lib/billing";
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

// In MOCK billing mode this immediately "activates" the new tier so the rest
// of the app can be built/tested. In STRIPE mode this would instead create a
// Checkout Session and only flip the tier once Stripe's webhook confirms
// payment (see lib/billing.ts).
router.post("/change", async (req: AuthedRequest, res) => {
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
