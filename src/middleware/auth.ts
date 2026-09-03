import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { db } from "../lib/store";
import { Tier, tierAtLeast } from "../types";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
  req.userId = payload.userId;
  next();
}

export function requireTier(minTier: Tier) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const sub = db.subscriptions.find((s) => s.userId === req.userId);
    const tier: Tier = sub?.tier ?? "BASIC";
    if (!tierAtLeast(tier, minTier)) {
      return res.status(403).json({
        error: `This feature requires the ${minTier} tier or higher. Your current tier is ${tier}.`,
        currentTier: tier,
        requiredTier: minTier,
      });
    }
    next();
  };
}
