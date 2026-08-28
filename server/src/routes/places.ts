import { Router } from "express";
import { placeSearch, nearbySearch, hotelSearch } from "../services/googleService.js";

const router = Router();

router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "Search query required" });
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    res.json(await placeSearch(q, lat, lng));
  } catch (e: any) { res.status(502).json({ message: "Live places unavailable", detail: e.message }); }
});

router.get("/nearby", async (req, res) => {
  try {
    const q = String(req.query.type || "").trim();
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!q || !Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ message: "type, lat and lng are required" });
    res.json(await nearbySearch(q, lat, lng));
  } catch (e: any) { res.status(502).json({ message: "Live places unavailable", detail: e.message }); }
});



router.get("/hotels", async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ message: "lat and lng are required" });
    res.json(await hotelSearch(lat, lng));
  } catch (e: any) {
    res.status(502).json({ message: "Hotel search unavailable", detail: e.message });
  }
});

export default router;
