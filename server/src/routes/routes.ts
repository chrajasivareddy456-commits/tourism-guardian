import { Router } from "express";
import { computeRoutes, nearestRoads } from "../services/googleService.js";
import { RestrictedZone } from "../models/RestrictedZone.js";
import { getWeather } from "../services/weatherService.js";
import { decodePolyline, pointInGeometry } from "../services/polyline.js";

const router = Router();

router.post("/compute", async (req, res) => {
  try {
    const { origin, destination } = req.body;
    if (!origin || !destination) return res.status(400).json({ message: "origin and destination required" });
    const data = await computeRoutes(origin, destination);
    const zones = await RestrictedZone.find({ enabled: true }).lean();
    let weatherRisk = 0;
    let weatherAvailable = true;
    try { const w:any = await getWeather(origin.lat, origin.lng); const c=String(w.condition||"").toLowerCase(); if(/thunder|storm|tornado/.test(c)) weatherRisk=20; else if(/heavy rain|rain/.test(c)) weatherRisk=10; else if(/snow|sleet/.test(c)) weatherRisk=12; } catch { weatherAvailable=false; }
    const routes = (data.routes || []).map((r: any) => {
      const trafficSeconds = Math.max(0, Number.parseFloat(String(r.duration || "0").replace("s", "")) - Number.parseFloat(String(r.staticDuration || "0").replace("s", "")));
      const trafficRisk = trafficSeconds > 900 ? 15 : trafficSeconds > 300 ? 8 : 0;
      const points = r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [];
      const restrictedHits = zones.filter((z:any) => points.some((p:any) => pointInGeometry(p, z.geometry)));
      const restrictedRisk = restrictedHits.length ? 30 : 0;
      const safetyScore = Math.max(0, Math.min(100, 100 - trafficRisk - weatherRisk - restrictedRisk));
      return { ...r, trafficDelaySeconds: trafficSeconds, safetyScore, safetyLabel: "Tourism Guardian calculated safety score", safetyFactors:{ trafficRisk, weatherRisk, weatherAvailable, restrictedZoneRisk:restrictedRisk, restrictedZones:restrictedHits.map((z:any)=>({id:z._id,name:z.name,reason:z.reason,source:z.source,lastUpdated:z.lastUpdated})) } };
    });
    res.json({ routes });
  } catch (e: any) { res.status(502).json({ message: "Live route data unavailable", detail: e.message }); }
});

router.get("/roads", async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ message: "Valid coordinates required" });
    res.json(await nearestRoads(lat, lng));
  } catch (e: any) { res.status(502).json({ message: "Road data unavailable", detail: e.message }); }
});

export default router;
