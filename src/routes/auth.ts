import { Router } from "express";
import { z } from "zod";
import { db, id, now, persist, deleteUserCascade } from "../lib/store";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { verifyAppleIdentityToken, AppleTokenError } from "../lib/appleAuth";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { User } from "../types";

const router = Router();

const profileFieldsSchema = z.object({
  displayName: z.string().min(1),
  niche: z.string().min(1),
  isAthlete: z.boolean().optional().default(false),
  sport: z.string().optional(),
  school: z.string().optional(),
  graduationYear: z.number().int().optional(),
});

// Shared by /signup and /apple (once we've verified/decided the email and
// optional Apple id): create the User + CreatorProfile + starter
// Subscription, sign a session token, and persist. Kept in one place so
// the two signup paths can never drift on what a "new account" looks like.
function createAccount(
  userFields: { email: string; passwordHash?: string; appleUserId?: string },
  profileFields: z.infer<typeof profileFieldsSchema>
) {
  const user: User = {
    id: id(),
    email: userFields.email,
    passwordHash: userFields.passwordHash,
    appleUserId: userFields.appleUserId,
    role: "CREATOR",
    createdAt: now(),
  };
  db.users.push(user);

  // Scope note: NIL-style athlete features are limited to college athletes
  // for now (not high school / minors) — see APP_STORE_READINESS.md and the
  // product notes on why. If a signup claims to be an athlete without
  // specifying college, we still allow the account but leave athlete
  // features off until they explicitly confirm COLLEGE level in profile.
  const profile = {
    id: id(),
    userId: user.id,
    displayName: profileFields.displayName,
    niche: profileFields.niche,
    isAthlete: !!profileFields.isAthlete,
    athleteLevel: profileFields.isAthlete ? ("COLLEGE" as const) : ("NONE" as const),
    sport: profileFields.sport,
    school: profileFields.school,
    graduationYear: profileFields.graduationYear,
    createdAt: now(),
  };
  db.creatorProfiles.push(profile);

  const subscription = {
    id: id(),
    userId: user.id,
    tier: "BASIC" as const,
    status: "trialing" as const,
    aiNegotiationsUsedThisPeriod: 0,
    periodStart: now(),
    createdAt: now(),
    updatedAt: now(),
  };
  db.subscriptions.push(subscription);
  persist();

  const token = signToken({ userId: user.id });
  return { token, user, profile, subscription };
}

const signupSchema = z.object({ email: z.string().email(), password: z.string().min(8, "Password must be at least 8 characters") }).and(profileFieldsSchema);

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { email, password, ...profileFields } = parsed.data;

  if (db.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await hashPassword(password);
  const { token, profile, subscription } = createAccount({ email, passwordHash }, profileFields);
  res.status(201).json({ token, profile, subscription });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { email, password } = parsed.data;

  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  if (!user.passwordHash) {
    return res.status(401).json({ error: "This account uses Sign in with Apple — there's no password to check. Use Sign in with Apple instead." });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken({ userId: user.id });
  res.json({ token });
});

const applePayloadSchema = z.object({
  identityToken: z.string().min(1),
}).and(profileFieldsSchema.partial());

// Sign in with Apple. One endpoint handles three cases so the app can always
// call the same thing after getting a token from Apple:
//   1. Returning user (appleUserId already on file)      -> log in
//   2. First time with Apple, but email matches an existing
//      password account                                  -> link + log in
//   3. Brand new person                                   -> needs profile
//      (displayName/niche etc, which Apple never provides) before an
//      account can be created; the client re-calls this same endpoint with
//      those fields added once the user fills them in.
router.post("/apple", async (req, res) => {
  const parsed = applePayloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { identityToken, ...profileFieldsRaw } = parsed.data;

  let claims;
  try {
    claims = await verifyAppleIdentityToken(identityToken);
  } catch (e) {
    const message = e instanceof AppleTokenError ? e.message : "Could not verify Apple identity token";
    return res.status(401).json({ error: message });
  }

  const existingByAppleId = db.users.find((u) => u.appleUserId === claims.sub);
  if (existingByAppleId) {
    const token = signToken({ userId: existingByAppleId.id });
    return res.json({ token, isNewAccount: false });
  }

  if (claims.email) {
    const existingByEmail = db.users.find((u) => u.email.toLowerCase() === claims.email!.toLowerCase());
    if (existingByEmail) {
      existingByEmail.appleUserId = claims.sub;
      persist();
      const token = signToken({ userId: existingByEmail.id });
      return res.json({ token, isNewAccount: false, linked: true });
    }
  }

  // Brand new person. We need at least a display name + niche (Apple never
  // provides these) before we can create the account — if the client hasn't
  // sent them yet, tell it to collect them and call this endpoint again.
  const profileParsed = profileFieldsSchema.safeParse(profileFieldsRaw);
  if (!profileParsed.success) {
    if (!claims.email) {
      return res.status(422).json({
        error: "Apple did not share an email for this account, and none was provided. Cannot create an account.",
      });
    }
    return res.json({ needsProfile: true, email: claims.email });
  }

  const { token, profile, subscription } = createAccount(
    { email: claims.email ?? `${claims.sub}@appleid.fairshare.app`, appleUserId: claims.sub },
    profileParsed.data
  );
  res.status(201).json({ token, profile, subscription, isNewAccount: true });
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const user = db.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const profile = db.creatorProfiles.find((p) => p.userId === user.id);
  const subscription = db.subscriptions.find((s) => s.userId === user.id);
  res.json({ user: { id: user.id, email: user.email, role: user.role }, profile, subscription });
});

// Required by Apple App Store Guideline 5.1.1(v): any app that lets a user
// create an account must let them delete it from inside the app.
router.delete("/me", requireAuth, (req: AuthedRequest, res) => {
  const user = db.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  deleteUserCascade(user.id);
  res.status(204).send();
});

export default router;
