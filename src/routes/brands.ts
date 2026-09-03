import { Router } from "express";
import { db } from "../lib/store";
import { AuthedRequest, requireAuth, requireTier } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// Browsing the brand directory is available to everyone (Pro+ can see it as
// part of market intelligence); actually *emailing* a brand from the app
// requires Advanced+ (see routes/outreach.ts).
router.get("/", (req: AuthedRequest, res) => {
  const { niche, athletesOnly } = req.query;
  let brands = db.brands;
  if (niche && typeof niche === "string") {
    brands = brands.filter((b) => b.preferredNiches.some((n) => n.toLowerCase() === niche.toLowerCase()));
  }
  if (athletesOnly === "true") {
    brands = brands.filter((b) => b.worksWithAthletes);
  }
  res.json({ brands });
});

router.get("/:id", (req, res) => {
  const brand = db.brands.find((b) => b.id === req.params.id);
  if (!brand) return res.status(404).json({ error: "Brand not found" });
  res.json({ brand });
});

export default router;
