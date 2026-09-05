import { Router } from "express";
import { z } from "zod";
import { db, id, now, persist } from "../lib/store";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { Platform } from "../types";

const router = Router();
router.use(requireAuth);

function getProfileOr404(req: AuthedRequest, res: any) {
  const profile = db.creatorProfiles.find((p) => p.userId === req.userId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return null;
  }
  return profile;
}

router.get("/", (req: AuthedRequest, res) => {
  const profile = getProfileOr404(req, res);
  if (!profile) return;
  const socialAccounts = db.socialAccounts.filter((s) => s.creatorProfileId === profile.id);
  res.json({ profile, socialAccounts });
});

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  bio: z.string().optional(),
  isAthlete: z.boolean().optional(),
  sport: z.string().optional(),
  school: z.string().optional(),
  graduationYear: z.number().int().optional(),
});

router.patch("/", (req: AuthedRequest, res) => {
  const profile = getProfileOr404(req, res);
  if (!profile) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  Object.assign(profile, parsed.data);
  if (parsed.data.isAthlete !== undefined) {
    // Athlete features are scoped to college athletes only (see product
    // notes) — flipping this on always sets COLLEGE, never a high-school
    // level, since the app does not support minors.
    profile.athleteLevel = parsed.data.isAthlete ? "COLLEGE" : "NONE";
  }
  persist();
  res.json({ profile });
});

const socialAccountSchema = z.object({
  platform: z.enum(["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "X", "TWITCH", "PODCAST"]),
  handle: z.string().min(1),
  followers: z.number().int().nonnegative(),
  engagementRate: z.number().nonnegative(),
});

router.post("/social-accounts", (req: AuthedRequest, res) => {
  const profile = getProfileOr404(req, res);
  if (!profile) return;
  const parsed = socialAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const existing = db.socialAccounts.find(
    (s) => s.creatorProfileId === profile.id && s.platform === parsed.data.platform
  );
  if (existing) {
    Object.assign(existing, parsed.data);
    persist();
    return res.json({ socialAccount: existing });
  }

  const account = {
    id: id(),
    creatorProfileId: profile.id,
    platform: parsed.data.platform as Platform,
    handle: parsed.data.handle,
    followers: parsed.data.followers,
    engagementRate: parsed.data.engagementRate,
    createdAt: now(),
  };
  db.socialAccounts.push(account);
  persist();
  res.status(201).json({ socialAccount: account });
});

export default router;
