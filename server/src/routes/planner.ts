import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { placeSearch, computeRoutes } from "../services/googleService.js";

const router = Router();

const arakuPlan = [
  [
    ["Borra Caves", "10:00 AM - 12:00 PM", "2 hours", "Start early; caves are best before afternoon crowds."],
    ["Katiki Waterfalls", "12:30 PM - 2:00 PM", "1.5 hours", "Wear comfortable shoes; the approach involves walking."],
    ["Coffee Museum", "3:00 PM - 4:00 PM", "1 hour", "Try Araku's local coffee."],
    ["Tribal Museum", "4:15 PM - 5:15 PM", "1 hour", "Learn about local tribal culture."]
  ],
  [
    ["Padmapuram Gardens", "8:00 AM - 9:30 AM", "1.5 hours", "Cool morning is ideal for the gardens."],
    ["Galikonda View Point", "10:00 AM - 11:00 AM", "1 hour", "Good time for valley views and photos."],
    ["Chaparai Waterfalls", "11:30 AM - 1:30 PM", "2 hours", "Avoid slippery rocks and follow local safety signs."],
    ["Araku Valley Coffee Plantations", "3:00 PM - 5:00 PM", "2 hours", "Reserve afternoon for a relaxed plantation visit."]
  ],
  [
    ["Dhimsa Village / Tribal Experience", "8:30 AM - 10:30 AM", "2 hours", "Prefer a local guide for cultural experiences."],
    ["Ananthagiri Hills", "11:00 AM - 1:00 PM", "2 hours", "Scenic drive and short viewpoints."],
    ["Araku Local Market", "3:00 PM - 4:30 PM", "1.5 hours", "Buy local coffee and handicrafts."],
    ["Araku Valley Sunset View", "5:00 PM - 6:15 PM", "1.25 hours", "Finish before it gets dark."]
  ]
];

router.post("/itinerary", auth, async (req, res) => {
  try {
    const { destination, interests = "tourist attractions", days = 1 } = req.body;
    if (!destination?.trim()) return res.status(400).json({ message: "Destination is required" });
    const count = Math.max(1, Math.min(7, Number(days) || 1));

    if (/araku/i.test(destination)) {
      const itinerary = Array.from({ length: count }, (_, d) => {
        const template = arakuPlan[d % arakuPlan.length];
        return {
          day: d + 1,
          stops: template.map(([name, time, duration, tip]) => ({
            place: { displayName: { text: name }, formattedAddress: "Araku Valley, Andhra Pradesh" },
            time, duration, tip
          }))
        };
      });
      return res.json({ destination, days: count, itinerary, pricingNote: "Timings are practical trip-planning suggestions; verify local opening hours before travel." });
    }

    const data: any = await placeSearch(`${interests} in ${destination}`);
    const places = (data.places || []).filter((p:any) => p.location?.latitude !== undefined).slice(0, count * 3);
    const itinerary:any[] = [];
    const times = ["9:00 AM - 11:00 AM", "11:30 AM - 1:00 PM", "3:00 PM - 5:00 PM"];
    for (let d=0; d<count; d++) {
      const dayPlaces = places.slice(d*3, d*3+3);
      const stops:any[] = [];
      for (let i=0; i<dayPlaces.length; i++) {
        const p = dayPlaces[i];
        let route = null;
        if (i > 0) {
          const prev = dayPlaces[i-1];
          route = await computeRoutes({lat:prev.location.latitude,lng:prev.location.longitude},{lat:p.location.latitude,lng:p.location.longitude});
        }
        stops.push({ place:p, routeFromPrevious:route?.routes?.[0] || null, time: times[i], duration: i === 2 ? "2 hours" : "1.5 hours", tip: "Check local opening hours and travel time before leaving." });
      }
      itinerary.push({ day:d+1, stops });
    }
    res.json({ destination, days:count, itinerary, pricingNote:"Timings are practical suggestions; verify local opening hours before travel." });
  } catch (e:any) { res.status(502).json({ message:"Live itinerary data unavailable", detail:e.message }); }
});

export default router;
