import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.js";
import placeRoutes from "./routes/places.js";
import routeRoutes from "./routes/routes.js";
import weatherRoutes from "./routes/weather.js";
import journeyRoutes from "./routes/journeys.js";
import emergencyRoutes from "./routes/emergency.js";
import plannerRoutes from "./routes/planner.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL }));
  app.use(express.json({ limit: "1mb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "tourism-guardian" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/places", placeRoutes);
  app.use("/api/routes", routeRoutes);
  app.use("/api/weather", weatherRoutes);
  app.use("/api/journeys", journeyRoutes);
  app.use("/api/emergency", emergencyRoutes);
  app.use("/api/planner", plannerRoutes);

  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}
