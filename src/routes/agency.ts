import { Router } from "express";
import { z } from "zod";
import { db, id, now, persist } from "../lib/store";
import { AuthedRequest, requireAuth, requireTier } from "../middleware/auth";

const router = Router();
router.use(requireAuth, requireTier("WHITE_LABEL"));

router.get("/", (req: AuthedRequest, res) => {
  const agency = db.agencies.find((a) => a.ownerUserId === req.userId);
  if (!agency) return res.status(404).json({ error: "No agency configured yet — create one first." });
  const clients = db.agencyClients.filter((c) => c.agencyId === agency.id).map((c) => {
    const profile = db.creatorProfiles.find((p) => p.userId === c.userId);
    const sub = db.subscriptions.find((s) => s.userId === c.userId);
    const activeDeals = profile
      ? db.deals.filter((d) => d.creatorProfileId === profile.id && ["DRAFT", "NEGOTIATING", "COUNTERED"].includes(d.status)).length
      : 0;
    return { client: c, profile, subscriptionTier: sub?.tier, activeDeals };
  });
  res.json({ agency, clients });
});

const createSchema = z.object({
  name: z.string().min(1),
  brandColor: z.string().optional(),
  logoUrl: z.string().optional(),
});

router.post("/", (req: AuthedRequest, res) => {
  let agency = db.agencies.find((a) => a.ownerUserId === req.userId);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  if (agency) {
    Object.assign(agency, parsed.data);
  } else {
    agency = {
      id: id(),
      ownerUserId: req.userId!,
      name: parsed.data.name,
      brandColor: parsed.data.brandColor ?? "#4F46E5",
      logoUrl: parsed.data.logoUrl,
      createdAt: now(),
    };
    db.agencies.push(agency);
  }
  persist();
  res.status(201).json({ agency });
});

const addClientSchema = z.object({ clientEmail: z.string().email() });

router.post("/clients", (req: AuthedRequest, res) => {
  const agency = db.agencies.find((a) => a.ownerUserId === req.userId);
  if (!agency) return res.status(404).json({ error: "Create an agency first via POST /agency" });

  const parsed = addClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const clientUser = db.users.find((u) => u.email.toLowerCase() === parsed.data.clientEmail.toLowerCase());
  if (!clientUser) return res.status(404).json({ error: "No Fair Share account found with that email — the client must sign up first." });

  if (db.agencyClients.find((c) => c.userId === clientUser.id)) {
    return res.status(409).json({ error: "That user is already managed by an agency." });
  }

  const link = { id: id(), agencyId: agency.id, userId: clientUser.id, addedAt: now() };
  db.agencyClients.push(link);
  persist();
  res.status(201).json({ agencyClient: link });
});

export default router;
