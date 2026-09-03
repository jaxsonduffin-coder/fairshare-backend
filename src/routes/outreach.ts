import { Router } from "express";
import { z } from "zod";
import { db, id, now, persist } from "../lib/store";
import { AuthedRequest, requireAuth, requireTier } from "../middleware/auth";
import { sendOutreachEmail } from "../lib/email";

const router = Router();
router.use(requireAuth, requireTier("ADVANCED"));

function getProfile(userId: string) {
  return db.creatorProfiles.find((p) => p.userId === userId);
}

// Suggest a first-touch outreach email to a brand, pre-filled from the
// creator's profile and the brand's typical budget band. Purely a draft —
// nothing is sent until POST /:id/send.
router.post("/draft", (req: AuthedRequest, res) => {
  const profile = getProfile(req.userId!);
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const schema = z.object({ brandId: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const brand = db.brands.find((b) => b.id === parsed.data.brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const subject = `Partnership idea: ${profile.displayName} x ${brand.name}`;
  const audienceLine = profile.isAthlete
    ? `a college athlete (${profile.sport ?? "athlete"}${profile.school ? ` at ${profile.school}` : ""})`
    : `a ${profile.niche} creator`;
  const body = [
    `Hi ${brand.name} team,`,
    "",
    `My name is ${profile.displayName}, and I'm ${audienceLine}. I think there's a great fit between my audience and ${brand.name}, especially given your work in the ${brand.industry} space.`,
    "",
    `I'd love to put together a content partnership — happy to share my current rates and past results. Typical partnerships in this range run $${brand.typicalBudgetMin.toLocaleString()}-$${brand.typicalBudgetMax.toLocaleString()}, and I can tailor a package to fit your goals and budget.`,
    "",
    "Would you be open to a quick call or email thread to explore this?",
    "",
    `Best,\n${profile.displayName}`,
  ].join("\n");

  const draft = {
    id: id(),
    creatorProfileId: profile.id,
    brandId: brand.id,
    subject,
    body,
    status: "DRAFT" as const,
    createdAt: now(),
  };
  db.outreachEmails.push(draft);
  persist();
  res.status(201).json({ outreachEmail: draft });
});

router.get("/", (req: AuthedRequest, res) => {
  const profile = getProfile(req.userId!);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const emails = db.outreachEmails.filter((e) => e.creatorProfileId === profile.id);
  res.json({ outreachEmails: emails });
});

const updateSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

router.patch("/:id", (req: AuthedRequest, res) => {
  const profile = getProfile(req.userId!);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const email = db.outreachEmails.find((e) => e.id === req.params.id && e.creatorProfileId === profile.id);
  if (!email) return res.status(404).json({ error: "Outreach email not found" });
  if (email.status !== "DRAFT") return res.status(400).json({ error: "Only drafts can be edited" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  Object.assign(email, parsed.data);
  persist();
  res.json({ outreachEmail: email });
});

router.post("/:id/send", async (req: AuthedRequest, res) => {
  const profile = getProfile(req.userId!);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const email = db.outreachEmails.find((e) => e.id === req.params.id && e.creatorProfileId === profile.id);
  if (!email) return res.status(404).json({ error: "Outreach email not found" });
  const brand = db.brands.find((b) => b.id === email.brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const result = await sendOutreachEmail({
    to: brand.contactEmail,
    fromName: profile.displayName,
    subject: email.subject,
    body: email.body,
  });

  email.status = result.mode === "MOCK" ? "MOCK_SENT" : "SENT";
  email.sentAt = now();
  persist();
  res.json({ outreachEmail: email, sendResult: result });
});

export default router;
