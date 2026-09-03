import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRoutes from "./routes/auth";
import profileRoutes from "./routes/profile";
import dealRoutes from "./routes/deals";
import brandRoutes from "./routes/brands";
import outreachRoutes from "./routes/outreach";
import subscriptionRoutes from "./routes/subscriptions";
import agencyRoutes from "./routes/agency";
import marketRoutes from "./routes/market";
import { aiAvailable } from "./lib/ai";
import { billingMode } from "./lib/billing";
import { emailMode } from "./lib/email";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      aiNarrativeEnabled: aiAvailable(),
      billingMode: billingMode(),
      emailMode: emailMode(),
    });
  });

  app.use("/auth", authRoutes);
  app.use("/profile", profileRoutes);
  app.use("/deals", dealRoutes);
  app.use("/brands", brandRoutes);
  app.use("/outreach", outreachRoutes);
  app.use("/subscriptions", subscriptionRoutes);
  app.use("/agency", agencyRoutes);
  app.use("/market", marketRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
