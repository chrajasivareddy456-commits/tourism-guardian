import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { placeSearch } from "../services/googleService.js";

const router = Router();

type Category = "nature" | "waterfalls" | "viewpoints" | "culture" | "history" | "museums" | "food" | "markets" | "adventure" | "relaxation";
type PoolPlace = {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location?: { latitude: number; longitude: number };
  category: Category;
  tip?: string;
  rating?: number;
};

type SeedPlace = { name: string; category: Category; tip: string };

// These are real fallback attractions, not day templates. They are only
// added when live place search does not return enough unique attractions.
const SEED_PLACES: Record<string, SeedPlace[]> = {
  araku: [
    { name: "Borra Caves", category: "nature", tip: "Start early; verify current entry timings before travel." },
    { name: "Katiki Waterfalls", category: "waterfalls", tip: "Wear proper footwear and follow local safety guidance." },
    { name: "Coffee Museum", category: "museums", tip: "Try locally produced Araku coffee." },
    { name: "Tribal Museum", category: "culture", tip: "Allow time for the local tribal history exhibits." },
    { name: "Padmapuram Gardens", category: "nature", tip: "Morning is comfortable for the gardens." },
    { name: "Galikonda View Point", category: "viewpoints", tip: "Good daytime valley views; avoid isolated stops after dark." },
    { name: "Chaparai Waterfalls", category: "waterfalls", tip: "Rocks can be slippery; follow signs and local advice." },
    { name: "Araku Valley Coffee Plantations", category: "nature", tip: "A relaxed plantation visit works well in the afternoon." },
    { name: "Dhimsa Village / Tribal Experience", category: "culture", tip: "Use a local guide for a respectful cultural experience." },
    { name: "Ananthagiri Hills", category: "viewpoints", tip: "Allow extra time for the scenic hill drive." },
    { name: "Araku Local Market", category: "markets", tip: "Look for local coffee and handicrafts." },
    { name: "Araku Valley Sunset Point", category: "viewpoints", tip: "Finish before dark and keep a return buffer." },
    { name: "Tyda Eco Park", category: "adventure", tip: "Check activity availability before visiting." },
    { name: "Sujana Wildlife Park", category: "nature", tip: "Confirm current opening status before departure." }
  ]
};

const CATEGORY_QUERIES: { category: Category; suffix: string }[] = [
  { category: "nature", suffix: "gardens nature parks wildlife" },
  { category: "waterfalls", suffix: "waterfalls" },
  { category: "viewpoints", suffix: "view points scenic viewpoints hills" },
  { category: "culture", suffix: "tribal cultural heritage places" },
  { category: "history", suffix: "historical monuments forts archaeological places" },
  { category: "museums", suffix: "museums" },
  { category: "markets", suffix: "local markets shopping streets" },
  { category: "adventure", suffix: "adventure eco tourism activities" },
  { category: "food", suffix: "local food cultural food experiences" }
];

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function seedKeyFor(destination: string) {
  return Object.keys(SEED_PLACES).find((key) => new RegExp(key, "i").test(destination));
}

function toPoolPlace(p: any, category: Category, fallbackAddress: string): PoolPlace | null {
  const name = String(p.displayName?.text || "").trim();
  const lat = Number(p.location?.latitude), lng = Number(p.location?.longitude);
  if (!name || name === "Unknown place") return null;
  return {
    id: p.id ? `live-${p.id}` : `live-${normalizeName(name)}`,
    displayName: { text: name },
    formattedAddress: p.formattedAddress || fallbackAddress,
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : undefined,
    category,
    rating: Number.isFinite(Number(p.rating)) ? Number(p.rating) : undefined
  };
}

async function buildPlacePool(destination: string, minSize: number, selectedPlaces: any[] = []) {
  const seen = new Map<string, PoolPlace>();

  // User-selected route/nearby attractions get highest priority, while still
  // being deduplicated against live results.
  for (const p of selectedPlaces) {
    const name = String(p?.displayName?.text || p?.name || "").trim();
    if (!name) continue;
    const place: PoolPlace = {
      id: String(p.id || `selected-${normalizeName(name)}`),
      displayName: { text: name },
      formattedAddress: p.formattedAddress || destination,
      location: p.location ? { latitude: Number(p.location.latitude), longitude: Number(p.location.longitude) } : undefined,
      category: (p.category as Category) || "nature",
      tip: p.tip
    };
    seen.set(normalizeName(name), place);
  }

  // Live data first. Fallback seed places are deliberately added only after
  // the live pool has been collected, so real API data wins over curated data.
  const results = await Promise.allSettled(
    CATEGORY_QUERIES.map((c) => placeSearch(`${c.suffix} in ${destination}`, undefined, undefined))
  );

  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const category = CATEGORY_QUERIES[index].category;
    for (const raw of (result.value as any)?.places || []) {
      const place = toPoolPlace(raw, category, destination);
      if (!place) continue;
      const nameKey = normalizeName(place.displayName.text);
      const existing = seen.get(nameKey);
      if (existing) {
        if (!existing.location && place.location) seen.set(nameKey, place);
        continue;
      }
      if (Array.from(seen.values()).some((x) => x.location && place.location && distanceKm(x.location, place.location) < 0.08)) continue;
      seen.set(nameKey, place);
    }
  });

  const key = seedKeyFor(destination);
  if (key) {
    for (const seed of SEED_PLACES[key]) {
      if (seen.size >= minSize) break;
      const nameKey = normalizeName(seed.name);
      if (Array.from(seen.values()).some((x) => normalizeName(x.displayName.text) === nameKey)) continue;
      seen.set(`seed-${nameKey}`, {
        id: `seed-${nameKey}`,
        displayName: { text: seed.name },
        formattedAddress: destination,
        category: seed.category,
        tip: seed.tip
      });
    }
  }

  // One more broad live query before considering any repeat. This is what
  // gives 5-7 day trips a larger pool instead of cycling a small template.
  if (seen.size < minSize) {
    const extras = await Promise.allSettled([
      placeSearch(`tourist attractions in ${destination}`),
      placeSearch(`hidden local attractions in ${destination}`),
      placeSearch(`parks temples heritage sites in ${destination}`)
    ]);
    for (const result of extras) {
      if (result.status !== "fulfilled") continue;
      for (const raw of (result.value as any)?.places || []) {
        const place = toPoolPlace(raw, "nature", destination);
        if (!place) continue;
        const nameKey = normalizeName(place.displayName.text);
        if (Array.from(seen.values()).some((x) => normalizeName(x.displayName.text) === nameKey)) continue;
        if (Array.from(seen.values()).some((x) => x.location && place.location && distanceKm(x.location, place.location) < 0.08)) continue;
        seen.set(nameKey, place);
      }
    }
  }

  return Array.from(seen.values());
}

// Select a unique sequence with category diversity and geographic locality.
// This is a greedy travel-guide ordering, not a cyclic/modulo template.
function orderPlaces(pool: PoolPlace[], totalSlots: number) {
  const remaining = [...pool];
  const ordered: PoolPlace[] = [];
  let previousCategory: Category | undefined;

  while (ordered.length < totalSlots && remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const categoryPenalty = previousCategory && candidate.category === previousCategory ? 2.5 : 0;
      const ratingBonus = candidate.rating ? candidate.rating * 0.6 : 0;
      const localityBonus = ordered.length && ordered[ordered.length - 1].location && candidate.location
        ? Math.max(0, 5 - distanceKm(ordered[ordered.length - 1].location!, candidate.location))
        : 1;
      const score = ratingBonus + localityBonus - categoryPenalty + (candidate.location ? 0.5 : 0);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    previousCategory = next.category;
  }

  return ordered;
}

type BudgetTier = "low" | "medium" | "high";
function budgetTier(perDay: number): BudgetTier {
  if (perDay < 2500) return "low";
  if (perDay < 6000) return "medium";
  return "high";
}

function budgetBreakdown(totalBudget: number, days: number) {
  const perDay = Math.round(totalBudget / Math.max(1, days));
  const tier = budgetTier(perDay);
  const shares = tier === "low"
    ? { accommodation: 0.28, food: 0.24, localTransport: 0.18, sightseeing: 0.12, fuel: 0.12, misc: 0.06 }
    : tier === "medium"
      ? { accommodation: 0.34, food: 0.21, localTransport: 0.15, sightseeing: 0.15, fuel: 0.10, misc: 0.05 }
      : { accommodation: 0.40, food: 0.18, localTransport: 0.13, sightseeing: 0.18, fuel: 0.07, misc: 0.04 };
  const round50 = (n: number) => Math.round(n / 50) * 50;
  const raw = {
    accommodation: round50(totalBudget * shares.accommodation),
    food: round50(totalBudget * shares.food),
    localTransport: round50(totalBudget * shares.localTransport),
    sightseeing: round50(totalBudget * shares.sightseeing),
    fuelOrEvCharging: round50(totalBudget * shares.fuel),
    miscellaneous: round50(totalBudget * shares.misc)
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  raw.miscellaneous += totalBudget - sum;
  return {
    tier,
    perDay,
    breakdown: raw,
    note: "Estimated planning split based on your total budget; verify live prices before travel."
  };
}

function stayLabel(tier: BudgetTier) {
  if (tier === "low") return "Budget stay / homestay";
  if (tier === "medium") return "Comfortable 3-star hotel / guesthouse";
  return "4-star hotel / resort or premium stay";
}

function transportLabel(tier: BudgetTier) {
  if (tier === "low") return "Local/shared transport";
  if (tier === "medium") return "Private cab / local taxi";
  return "Private cab / dedicated driver";
}

router.post("/itinerary", auth, async (req, res) => {
  try {
    const { destination, days = 1, budget, selectedPlaces = [] } = req.body;
    if (!destination?.trim()) return res.status(400).json({ message: "Destination is required" });

    const dayCount = Math.max(1, Math.min(7, Number(days) || 1));
    const totalBudget = Number(budget) > 0 ? Number(budget) : undefined;
    const budgetInfo = totalBudget ? budgetBreakdown(totalBudget, dayCount) : undefined;
    const tier: BudgetTier = budgetInfo?.tier || "medium";
    const lastDaySlots = dayCount > 1 ? 2 : 3;
    const totalSlots = Math.max(3, (dayCount - 1) * 3 + lastDaySlots);

    const pool = await buildPlacePool(destination.trim(), totalSlots, Array.isArray(selectedPlaces) ? selectedPlaces : []);
    const ordered = orderPlaces(pool, totalSlots);

    // Do not pretend a missing real place is a new attraction. If the live
    // pool is too small, days simply have fewer attractions rather than repeats.
    const SLOT_TIMES = [
      { label: "Morning", window: "09:00 AM - 11:00 AM", icon: "🌅" },
      { label: "Afternoon", window: "01:30 PM - 03:30 PM", icon: "🌄" },
      { label: "Evening", window: "04:30 PM - 06:00 PM", icon: "🌇" }
    ];

    const dailyCosts = (() => {
      if (!budgetInfo) return Array(dayCount).fill(undefined);
      if (dayCount === 1) return [totalBudget];
      const last = Math.round(totalBudget! / dayCount * 0.65);
      const normal = Math.floor((totalBudget! - last) / (dayCount - 1));
      const costs = Array(dayCount - 1).fill(normal);
      costs.push(totalBudget! - normal * (dayCount - 1));
      return costs;
    })();

    let offset = 0;
    const itinerary = Array.from({ length: dayCount }, (_, d) => {
      const isLastDay = dayCount > 1 && d === dayCount - 1;
      const slotCount = isLastDay ? 2 : 3;
      const dayPlaces = ordered.slice(offset, offset + slotCount);
      offset += slotCount;

      const stops = dayPlaces.map((p, i) => ({
        slot: SLOT_TIMES[i].label,
        icon: SLOT_TIMES[i].icon,
        time: SLOT_TIMES[i].window,
        place: { id: p.id, displayName: p.displayName, formattedAddress: p.formattedAddress, location: p.location },
        category: p.category,
        duration: i === 1 ? "2 hours" : "1.5 hours",
        tip: p.tip || "Check local opening hours and travel time before leaving."
      }));

      const withTravel = stops.map((stop: any, i: number) => {
        const previous = i === 0 ? undefined : stops[i - 1];
        if (!previous?.place?.location || !stop.place?.location) return stop;
        const km = distanceKm(previous.place.location, stop.place.location);
        return { ...stop, routeFromPrevious: { distanceMeters: Math.round(km * 1000), durationMinutes: Math.max(5, Math.round(km * 2.2)) } };
      });

      return {
        day: d + 1,
        title: isLastDay ? "Light sightseeing + return journey" : `Day ${d + 1} · ${tier === "low" ? "Value-focused" : tier === "medium" ? "Balanced" : "Comfortable"} exploration`,
        stops: withTravel,
        lunch: { time: "12:00 PM - 01:00 PM", note: tier === "low" ? "Local restaurant / dhaba" : tier === "medium" ? "Local restaurant" : "Recommended local restaurant" },
        stay: isLastDay ? "Return travel day" : stayLabel(tier),
        transport: transportLabel(tier),
        estimatedCost: dailyCosts[d],
        safetyTip: isLastDay ? "Keep the final day lighter and leave a daylight buffer for return travel." : "Finish outdoor activities before dark and keep emergency access available."
      };
    });

    res.json({
      destination,
      days: dayCount,
      itinerary,
      budget: budgetInfo,
      poolSize: pool.length,
      uniquePlaceCount: new Set(ordered.map((p) => normalizeName(p.displayName.text))).size,
      pricingNote: "Accommodation, food, transport and sightseeing costs are planning estimates, not live quotations. The generated plan never allocates more than the user's total budget."
    });
  } catch (e: any) {
    res.status(502).json({ message: "Live itinerary data unavailable", detail: e.message });
  }
});

export default router;
