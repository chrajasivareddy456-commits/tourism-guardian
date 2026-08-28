import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";
import MapView from "../components/MapView";
import LiveStatus from "../components/LiveStatus";
import { watchLocation } from "../services/location";
import { readBattery } from "../services/battery";
import { startImpactMonitor } from "../services/sensors";

const states = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry"
];

type Place = any;

// --------------------------------------------------
// HAVERSINE DISTANCE (km) — used to sort stations by
// real distance from the user's live GPS location
// --------------------------------------------------
function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// --------------------------------------------------
// DECODE GOOGLE'S ENCODED POLYLINE
// /routes/compute returns each route's path as an
// encoded polyline (r.polyline.encodedPolyline) — this
// turns it back into real lat/lng points so we can check
// whether the user has drifted off it.
// --------------------------------------------------
function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

// Shortest distance (km) from a point to a single segment A-B,
// using a flat local projection (fine at city/road scale).
function distanceToSegmentKm(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const R = 6371;
  const toXY = (pt: { lat: number; lng: number }) => {
    const latRad = (pt.lat * Math.PI) / 180;
    return {
      x: R * ((pt.lng * Math.PI) / 180) * Math.cos(latRad),
      y: R * ((pt.lat * Math.PI) / 180)
    };
  };

  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);

  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lengthSq = dx * dx + dy * dy;

  let t = lengthSq === 0 ? 0 : ((P.x - A.x) * dx + (P.y - A.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = A.x + t * dx;
  const projY = A.y + t * dy;

  return Math.sqrt((P.x - projX) ** 2 + (P.y - projY) ** 2);
}

// Shortest distance (km) from the user's current point to
// the whole route path.
function minDistanceToPathKm(
  point: { lat: number; lng: number },
  path: { lat: number; lng: number }[]
) {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distanceKm(point, path[0]);

  let min = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegmentKm(point, path[i], path[i + 1]);
    if (d < min) min = d;
  }

  return min;
}

type AlertItem = {
  id: string;
  severity: "warning" | "critical";
  message: string;
  actionLabel?: string;
};

export default function Home({ view = "home" }: { view?: "home" | "destination" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const language = useAuth((s) => s.language);
  const setLanguage = useAuth((s) => s.setLanguage);
  const initialDestination = (location.state as any)?.destination;
  const labels: any = {
    en: { home:"Home", profile:"Profile", search:"Search", destination:"Destination", logout:"Logout", download:"Download for offline", plan:"Trip Planner" },
    te: { home:"హోమ్", profile:"ప్రొఫైల్", search:"శోధించండి", destination:"గమ్యం", logout:"లాగౌట్", download:"ఆఫ్‌లైన్ కోసం డౌన్‌లోడ్", plan:"ట్రిప్ ప్లానర్" },
    hi: { home:"होम", profile:"प्रोफ़ाइल", search:"खोजें", destination:"गंतव्य", logout:"लॉगआउट", download:"ऑफलाइन डाउनलोड", plan:"ट्रिप प्लानर" }
  };
  const t = (key: string) => labels[language]?.[key] || labels.en[key] || key;

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [recommendations, setRecommendations] = useState<Place[]>([]);

  const [loc, setLoc] = useState<any>();
  const [dest, setDest] = useState<Place>();
  useEffect(() => {
    if (view === "destination" && initialDestination) setDest(initialDestination);
  }, [view, initialDestination?.id]);
  const [weather, setWeather] = useState<any>();
  const [nearby, setNearby] = useState<Place[]>([]);
  const [nearbyType, setNearbyType] = useState<string>(""); // tracks which button was pressed, for map pin icons
  const [showNearbyModal, setShowNearbyModal] = useState(false); // popup instead of scrolling to bottom
  const [expandedPlaceId, setExpandedPlaceId] = useState<string | number | null>(null); // which hotel card is showing price
  const mapSectionRef = useRef<HTMLDivElement>(null); // so we can scroll the map into view after picking a place

  const [battery, setBattery] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(localStorage.getItem("tg_offline_ready") === "true");
  const [offlineDownloading, setOfflineDownloading] = useState(false);

  const [journey, setJourney] = useState<any>();

  const [routes, setRoutes] = useState<any[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);

  const [message, setMessage] = useState("");

  const [handshake, setHandshake] = useState(false);
  const [countdown, setCountdown] = useState(15);

  // --------------------------------------------------
  // DEDICATED POLICE / TRANSPORT SCREENS
  // --------------------------------------------------
  const [stationScreen, setStationScreen] = useState<
    "police" | "transport" | null
  >(null);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationResults, setStationResults] = useState<
    (Place & { _distanceKm?: number; _kind?: string })[]
  >([]);
  const [nearestRoute, setNearestRoute] = useState<any[]>([]);
  const [nearestRouteLoading, setNearestRouteLoading] = useState(false);

  // --------------------------------------------------
  // LIVE ALERTS (battery / weather / off-route)
  // --------------------------------------------------
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  // SIMPLE LIVE RISK SCORE — based only on conditions already used by the app.
  const risk = useMemo(() => {
    let score = 0;
    const hazards: string[] = [];

    const condition = String(weather?.condition || "").toLowerCase();
    const severe = ["storm", "thunder", "cyclone", "hail", "heavy rain", "flood", "extreme"].some(k => condition.includes(k));
    const temp = Number(weather?.temperature);

    if (severe) { score += 30; hazards.push(`Severe weather: ${weather?.condition || "dangerous weather"}`); }
    else if (Number.isFinite(temp) && (temp >= 42 || temp <= 4)) { score += 15; hazards.push(`Extreme temperature: ${Math.round(temp)}°C`); }
    if (battery !== null && battery <= 10) { score += 10; hazards.push("Critical low battery"); }
    else if (battery !== null && battery <= 20) { score += 5; hazards.push("Low battery"); }
    if (!online) { score += 8; hazards.push("No network connection"); }
    if (alerts.some(a => a.id === "route")) { score += 20; hazards.push("Route deviation"); }
    if (alerts.some(a => a.id === "battery" && a.severity === "critical")) hazards.push("Live tracking may stop soon");
    score = Math.min(100, score);
    const level = score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
    return { score, level, hazards };
  }, [weather, battery, online, alerts]);
  // ids the user has manually dismissed — condition still
  // holds, but we won't re-show until it clears and re-fires
  const dismissedAlerts = useRef<Set<string>>(new Set());

  function upsertAlert(alert: AlertItem) {
    if (dismissedAlerts.current.has(alert.id)) return;

    setAlerts((prev) => {
      const existing = prev.find((a) => a.id === alert.id);
      if (existing && existing.message === alert.message) return prev;
      return [...prev.filter((a) => a.id !== alert.id), alert];
    });
  }

  // condition returned to normal — clear it and allow it to
  // fire again next time it happens
  function clearAlertCondition(id: string) {
    dismissedAlerts.current.delete(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  function dismissAlert(id: string) {
    dismissedAlerts.current.add(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  // --------------------------------------------------
  // SIMPLIFIED TRIP PACKAGE INPUTS
  // (destination, days, total budget for the whole trip)
  // --------------------------------------------------
  const [days, setDays] = useState(3);
  const [totalBudget, setTotalBudget] = useState<number>(0);

  const [itinerary, setItinerary] = useState<any>(null);
  const [itineraryLoading, setItineraryLoading] = useState(false);

  const lastSent = useRef(0);

  const perDayBudget = useMemo(
    () => (days > 0 ? Math.round(totalBudget / days) : 0),
    [totalBudget, days]
  );

  // --------------------------------------------------
  // REAL GPS + BATTERY + SAFETY SENSOR
  // --------------------------------------------------

  useEffect(() => {
    const stop = watchLocation(
      (l) => setLoc(l),
      (e) => setMessage(`Location unavailable: ${e.message}`)
    );

    readBattery().then((b) =>
      setBattery(b?.level ?? null)
    );

    const impactStop = startImpactMonitor(() =>
      startHandshake("POSSIBLE_IMPACT")
    );

    const onlineHandler = () => setOnline(true);
    const offHandler = () => setOnline(false);

    addEventListener("online", onlineHandler);
    addEventListener("offline", offHandler);

    return () => {
      stop();
      impactStop();

      removeEventListener("online", onlineHandler);
      removeEventListener("offline", offHandler);
    };
  }, []);

  // --------------------------------------------------
  // LIVE WEATHER
  // --------------------------------------------------

  useEffect(() => {
    if (!loc) return;

    const timer = setTimeout(() => {
      api
        .get("/weather", {
          params: {
            lat: loc.lat,
            lng: loc.lng
          }
        })
        .then((r) => setWeather(r.data))
        .catch(() => setWeather(null));
    }, 800);

    return () => clearTimeout(timer);
  }, [loc?.lat, loc?.lng]);

  // --------------------------------------------------
  // ALERT: LOW BATTERY
  // (battery is stored as a plain 0–100 percentage — see
  // LiveStatus, which renders it as `${battery}%`)
  // --------------------------------------------------

  useEffect(() => {
    if (battery === null) return;

    if (battery <= 10) {
      upsertAlert({
        id: "battery",
        severity: "critical",
        message: `🔋 Battery critically low (${battery}%) — live tracking and SOS may stop working soon. Charge now if possible.`
      });
    } else if (battery <= 20) {
      upsertAlert({
        id: "battery",
        severity: "warning",
        message: `🔋 Battery low (${battery}%) — consider turning on battery saver.`
      });
    } else {
      clearAlertCondition("battery");
    }
  }, [battery]);

  // --------------------------------------------------
  // ALERT: SEVERE / EXTREME WEATHER
  // --------------------------------------------------

  useEffect(() => {
    if (!weather) return;

    const condition = String(weather.condition || "").toLowerCase();
    const temp = weather.temperature;

    const severeKeywords = [
      "storm",
      "thunder",
      "cyclone",
      "hail",
      "heavy rain",
      "flood",
      "extreme"
    ];

    const isSevere = severeKeywords.some((k) => condition.includes(k));

    if (isSevere) {
      upsertAlert({
        id: "weather",
        severity: "critical",
        message: `⛈️ Severe weather nearby: ${weather.condition}. Consider postponing outdoor travel.`
      });
    } else if (typeof temp === "number" && (temp >= 42 || temp <= 4)) {
      upsertAlert({
        id: "weather",
        severity: "warning",
        message: `🌡️ Extreme temperature right now (${Math.round(
          temp
        )}°C) — stay hydrated / dress warmly.`
      });
    } else {
      clearAlertCondition("weather");
    }
  }, [weather]);

  // --------------------------------------------------
  // ALERT: OFF-ROUTE DETECTION
  // Decodes the active journey's route polyline once, then
  // checks the user's live GPS distance to that path on every
  // location update. Flags it if they've drifted too far.
  // --------------------------------------------------

  const routePath = useMemo(() => {
    const encoded = routes[selectedRoute]?.polyline?.encodedPolyline;
    return encoded ? decodePolyline(encoded) : [];
  }, [routes, selectedRoute]);

  const OFF_ROUTE_THRESHOLD_KM = 0.3; // 300 m

  useEffect(() => {
    if (!journey || !loc || routePath.length < 2) {
      clearAlertCondition("route");
      return;
    }

    const offRouteKm = minDistanceToPathKm(loc, routePath);

    if (offRouteKm > OFF_ROUTE_THRESHOLD_KM) {
      upsertAlert({
        id: "route",
        severity: "warning",
        message: `🧭 You appear to be ~${Math.round(
          offRouteKm * 1000
        )} m off the planned route.`,
        actionLabel: "Recalculate route"
      });
    } else {
      clearAlertCondition("route");
    }
  }, [loc?.lat, loc?.lng, routePath, journey]);

  async function recalculateRoute() {
    if (!loc || !dest) return;

    try {
      const r = await api.post("/routes/compute", {
        origin: { lat: loc.lat, lng: loc.lng },
        destination: {
          lat: dest.location.latitude,
          lng: dest.location.longitude
        }
      });

      setRoutes(r.data.routes || []);
      setSelectedRoute(0);
      clearAlertCondition("route");

    } catch {
      setMessage("Live route recalculation unavailable");
    }
  }

  // --------------------------------------------------
  // SEND LIVE LOCATION TO JOURNEY
  // --------------------------------------------------

  useEffect(() => {
    if (!journey || !loc) return;

    if (Date.now() - lastSent.current < 4000) return;

    lastSent.current = Date.now();

    api
      .patch(`/journeys/${journey._id}/location`, {
        ...loc,
        battery,
        online
      })
      .then((r) => {
        if (r.data.restrictedZones?.length) {
          setMessage(
            `⚠️ Restricted zone: ${r.data.restrictedZones[0].name}`
          );
        }
      })
      .catch(() => {});
  }, [loc, journey, battery, online]);

  // --------------------------------------------------
  // SAFETY HANDSHAKE COUNTDOWN
  // --------------------------------------------------

  useEffect(() => {
    if (!handshake) return;

    setCountdown(15);

    const timer = setInterval(() => {
      setCountdown((v) => {
        if (v <= 1) {
          clearInterval(timer);
          escalateHandshake();
          return 0;
        }

        return v - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [handshake]);

  // --------------------------------------------------
  // SEARCH REAL PLACES
  // --------------------------------------------------

  async function search() {
    if (!q.trim()) return;

    try {
      const r = await api.get("/places/search", {
        params: {
          q,
          lat: loc?.lat,
          lng: loc?.lng
        }
      });

      const places = r.data.places || [];
      setResults(places);
      setRecommendations([]);
      localStorage.setItem("tg_last_search", JSON.stringify({ q, places, savedAt: Date.now() }));

    } catch {
      const cached = JSON.parse(localStorage.getItem("tg_last_search") || "null");
      if (cached?.places) {
        setResults(cached.places);
        setMessage("Offline mode: showing your last saved search.");
      } else setMessage("Live place search unavailable");
    }
  }

  // --------------------------------------------------
  // STATE DISCOVERY
  // --------------------------------------------------

  async function selectState(s: string) {
    setQ(s);

    try {
      const r = await api.get("/places/search", {
        params: {
          q: `top tourist attractions in ${s}`
        }
      });

      setRecommendations(r.data.places || []);
      setResults([]);

    } catch {
      setRecommendations([]);
      setMessage("Live recommendations unavailable");
    }
  }

  // --------------------------------------------------
  // SELECT DESTINATION
  // --------------------------------------------------

  function selectDestination(place: Place) {
    setDest(place);

    setRoutes([]);
    setSelectedRoute(0);
    setNearby([]);
    setItinerary(null); // reset any previously generated package for the old destination

    // Remove old black toast/message
    setMessage("");
    navigate("/destination", { state: { destination: place } });
  }

  // --------------------------------------------------
  // NEARBY REAL PLACES (generic — used by Hospitals / Hotels)
  // --------------------------------------------------

  async function nearbySearch(type: string) {
    if (!loc) {
      setMessage("Allow real location first");
      return;
    }

    try {
      const r = await api.get(type === "hotel" ? "/places/hotels" : "/places/nearby", {
        params: {
          type,
          lat: loc.lat,
          lng: loc.lng
        }
      });

      const places = r.data.places || [];
      setNearby(places);
      localStorage.setItem(`tg_nearby_${type}`, JSON.stringify(places));
      setNearbyType(type); // remember category so map pins get the right icon
      setShowNearbyModal(true); // pop the results up instead of relying on scroll position
      setExpandedPlaceId(null); // reset any previously expanded price card

    } catch {
      const cached = JSON.parse(localStorage.getItem(`tg_nearby_${type}`) || "null");
      if (cached) {
        setNearby(cached);
        setNearbyType(type);
        setShowNearbyModal(true);
        setMessage("Offline mode: showing saved nearby places.");
      } else setMessage("Live nearby data unavailable");
    }
  }

  // --------------------------------------------------
  // APPROX PER-DAY HOTEL PRICE FROM GOOGLE'S priceLevel
  // (Google Places doesn't return exact nightly rates —
  // only a coarse tier. For real ₹ prices, connect a
  // hotel-pricing API like Booking.com/MakeMyTrip on the
  // backend and return it as p.priceRange from /places/nearby)
  // --------------------------------------------------

  function priceLevelToRange(level?: string) {
    switch (level) {
      case "PRICE_LEVEL_INEXPENSIVE":
        return "₹800 – ₹1,500 / day (approx)";
      case "PRICE_LEVEL_MODERATE":
        return "₹1,500 – ₹3,500 / day (approx)";
      case "PRICE_LEVEL_EXPENSIVE":
        return "₹3,500 – ₹7,000 / day (approx)";
      case "PRICE_LEVEL_VERY_EXPENSIVE":
        return "₹7,000+ / day (approx)";
      default:
        return null;
    }
  }

  function renderPriceInfo(p: Place) {
    // Prefer a real backend-provided price range if you add one
    if (p.priceRange?.startPrice && p.priceRange?.endPrice) {
      return (
        <b>
          💰 ₹{p.priceRange.startPrice.units} – ₹
          {p.priceRange.endPrice.units} / day
        </b>
      );
    }

    const approx = priceLevelToRange(p.priceLevel);

    if (approx) {
      return <b>💰 {approx}</b>;
    }

    return (
      <span className="muted">
        Live per-day price not available from this data source.
        Connect a hotel-pricing API (Booking.com/MakeMyTrip/Google Hotels)
        on the backend to show real ₹ rates here.
      </span>
    );
  }

  // --------------------------------------------------
  // NAVIGATE TO A NEARBY PLACE (map pin tap)
  // Reuses the same /routes/compute backend used by
  // startJourney, so safety score / traffic duration
  // all work the same way.
  // --------------------------------------------------

  async function navigateToNearbyPlace(place: Place) {
    selectDestination(place);
    setShowNearbyModal(false); // close the popup once a place is picked

    if (!loc) {
      setMessage("Allow real location first");
      return;
    }

    try {
      const r = await api.post("/routes/compute", {
        origin: {
          lat: loc.lat,
          lng: loc.lng
        },
        destination: {
          lat: place.location.latitude,
          lng: place.location.longitude
        }
      });

      setRoutes(r.data.routes || []);
      setSelectedRoute(0);

      // bring the map into view so the route is immediately visible
      mapSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    } catch {
      setMessage("Live route data unavailable");
    }
  }

  // --------------------------------------------------
  // POLICE — dedicated screen
  // Fetches real nearby police stations, sorts by actual
  // GPS distance (nearest first), and pre-computes the
  // route to the closest one so the map is useful immediately.
  // --------------------------------------------------

  async function openPoliceStations() {
    if (!loc) {
      setMessage("Allow real location first");
      return;
    }

    setStationScreen("police");
    setStationLoading(true);
    setStationResults([]);
    setNearestRoute([]);

    try {
      const r = await api.get("/places/nearby", {
        params: {
          // Google Places only recognizes "police" — "police station"
          // is not a valid type and silently returns zero results
          type: "police",
          lat: loc.lat,
          lng: loc.lng
        }
      });

      const places = (r.data.places || []).map((p: Place) => ({
        ...p,
        _kind: "police",
        _distanceKm: p.location
          ? distanceKm(loc, {
              lat: p.location.latitude,
              lng: p.location.longitude
            })
          : undefined
      }));

      places.sort(
        (a: any, b: any) =>
          (a._distanceKm ?? Infinity) - (b._distanceKm ?? Infinity)
      );

      setStationResults(places);

      if (places[0]) fetchRouteToStation(places[0]);

    } catch {
      setMessage("Live police station data unavailable");
    } finally {
      setStationLoading(false);
    }
  }

  // --------------------------------------------------
  // TRANSPORT — dedicated screen
  // Merges real nearby railway stations AND bus stands
  // into one list, sorted by actual GPS distance.
  // --------------------------------------------------

  async function openTransportStations() {
    if (!loc) {
      setMessage("Allow real location first");
      return;
    }

    setStationScreen("transport");
    setStationLoading(true);
    setStationResults([]);
    setNearestRoute([]);

    try {
      const [trainRes, busRes] = await Promise.all([
        // Google Places uses underscored type keywords, not
        // free-text phrases — "train station" / "bus station"
        // (with a space) match nothing
        api.get("/places/nearby", {
          params: { type: "train_station", lat: loc.lat, lng: loc.lng }
        }),
        api.get("/places/nearby", {
          params: { type: "bus_station", lat: loc.lat, lng: loc.lng }
        })
      ]);

      const train = (trainRes.data.places || []).map((p: Place) => ({
        ...p,
        _kind: "train"
      }));

      const bus = (busRes.data.places || []).map((p: Place) => ({
        ...p,
        _kind: "bus"
      }));

      const merged = [...train, ...bus].map((p) => ({
        ...p,
        _distanceKm: p.location
          ? distanceKm(loc, {
              lat: p.location.latitude,
              lng: p.location.longitude
            })
          : undefined
      }));

      merged.sort(
        (a, b) => (a._distanceKm ?? Infinity) - (b._distanceKm ?? Infinity)
      );

      setStationResults(merged);

      if (merged[0]) fetchRouteToStation(merged[0]);

    } catch {
      setMessage("Live transport data unavailable");
    } finally {
      setStationLoading(false);
    }
  }

  // --------------------------------------------------
  // Compute + show the real route to a specific station
  // (called automatically for the nearest one, and again
  // whenever the user taps "Show route here" on another)
  // --------------------------------------------------

  async function fetchRouteToStation(place: Place) {
    if (!loc || !place?.location) return;

    setNearestRouteLoading(true);

    try {
      const r = await api.post("/routes/compute", {
        origin: { lat: loc.lat, lng: loc.lng },
        destination: {
          lat: place.location.latitude,
          lng: place.location.longitude
        }
      });

      setNearestRoute(r.data.routes || []);

    } catch {
      setNearestRoute([]);
    } finally {
      setNearestRouteLoading(false);
    }
  }

  function closeStationScreen() {
    setStationScreen(null);
    setStationResults([]);
    setNearestRoute([]);
  }

  // --------------------------------------------------
  // START REAL GPS JOURNEY
  // --------------------------------------------------

  async function startJourney() {
    if (!dest || !loc) {
      setMessage(
        "Select a real destination and allow GPS"
      );
      return;
    }

    try {
      const j = await api.post("/journeys", {
        destination: {
          placeId: dest.id,
          name: dest.displayName?.text,
          address: dest.formattedAddress,
          lat: dest.location.latitude,
          lng: dest.location.longitude
        },
        consentedTracking: true
      });

      setJourney(j.data);

      const r = await api.post("/routes/compute", {
        origin: {
          lat: loc.lat,
          lng: loc.lng
        },
        destination: {
          lat: dest.location.latitude,
          lng: dest.location.longitude
        }
      });

      setRoutes(r.data.routes || []);
      setSelectedRoute(0);

    } catch {
      setMessage(
        "Live journey/route data unavailable"
      );
    }
  }

  // --------------------------------------------------
  // SOS
  // --------------------------------------------------

  async function sendSOS() {
    if (!loc) {
      setMessage(
        "Real current location is required for SOS"
      );
      return;
    }

    if (
      !confirm(
        "SEND SOS with your current location?"
      )
    ) {
      return;
    }

    try {
      await api.post("/emergency", {
        type: "MANUAL_SOS",
        journeyId: journey?._id,
        lat: loc.lat,
        lng: loc.lng,
        trigger: "MANUAL_SOS",
        metadata: {
          battery,
          online,
          riskScore: risk.score,
          riskLevel: risk.level,
          hazards: risk.hazards
        }
      });

      setMessage(
        "🚨 SOS event sent to the authority dashboard."
      );

    } catch {
      setMessage("Offline: SOS could not reach the authority server. Your emergency contact can still be called.");
    }

    const savedUser = JSON.parse(localStorage.getItem("tg_user") || "null");
    const contact = savedUser?.trustedContact;
    if (contact?.phone && confirm(`Call ${contact.name || "your emergency contact"} now?`)) {
      window.location.href = `tel:${contact.phone}`;
    }
  }

  // --------------------------------------------------
  // SAFETY HANDSHAKE
  // --------------------------------------------------

  function startHandshake(trigger: string) {
    if (handshake) return;

    setHandshake(true);

    setMessage(
      `⚠️ ${trigger.split("_").join(" ")} detected. Are you OK?`
    );
  }

  async function escalateHandshake() {
    setHandshake(false);

    if (!loc) return;

    try {
      if (journey?._id) {
        await api.post(
          `/journeys/${journey._id}/handshake`,
          {
            lat: loc.lat,
            lng: loc.lng,
            trigger:
              "POSSIBLE_IMPACT_NO_RESPONSE",
            battery,
            online
          }
        );
      } else {
        await api.post("/emergency", {
          type: "UNRESPONSIVE_HANDSHAKE",
          lat: loc.lat,
          lng: loc.lng,
          trigger:
            "POSSIBLE_IMPACT_NO_RESPONSE",
          metadata: {
            battery,
            online,
            riskScore: risk.score,
            riskLevel: risk.level,
            hazards: risk.hazards
          }
        });
      }

      setMessage(
        "Possible emergency escalated to the authority dashboard."
      );

    } catch {
      setMessage(
        "Emergency escalation unavailable."
      );
    }
  }

  function cancelHandshake() {
    setHandshake(false);

    setMessage(
      "Safety check cancelled — marked as safe."
    );
  }

  // --------------------------------------------------
  // GENERATE DAY-WISE TRIP PACKAGE
  // Only two real inputs: number of days + total budget
  // for the whole trip. Everything else (per-day split,
  // places for each day) is computed / fetched live.
  // --------------------------------------------------

  async function buildItinerary() {
    if (!dest) {
      setMessage("Select a real destination first");
      return;
    }

    if (!days || days < 1) {
      setMessage("Enter a valid number of days");
      return;
    }

    if (!totalBudget || totalBudget <= 0) {
      setMessage("Enter your total trip budget");
      return;
    }

    setItineraryLoading(true);

    try {
      const r = await api.post("/planner/itinerary", {
        destination: dest.displayName?.text,
        days,
        people: 1,
        interests:
          "tourist attractions restaurants cultural places",
        budget: {
          total: totalBudget,
          perDay: perDayBudget
        }
      });

      setItinerary(r.data);
      localStorage.setItem(`tg_itinerary_${dest.id || dest.displayName?.text}`, JSON.stringify(r.data));

    } catch {
      const cached = JSON.parse(localStorage.getItem(`tg_itinerary_${dest.id || dest.displayName?.text}`) || "null");
      if (cached) setItinerary(cached);
      else setMessage("Live itinerary data unavailable");
    } finally {
      setItineraryLoading(false);
    }
  }

  // --------------------------------------------------
  // BUDGET PLANNING BREAKDOWN
  // Splits the trip into Stay / Food / Local transport /
  // Misc, matching the "Estimated cost (per person)" card.
  // It always sums to the user's own total budget:
  //   - If the itinerary suggested a real place to stay and
  //     Google returned a priceLevel for it, that place's
  //     approx nightly rate is used for the Stay line.
  //   - Everything else is the remaining budget split across
  //     Food / Local transport / Misc using a standard
  //     travel-budget ratio (42% / 25% / 33% of what's left),
  //     since there's no live per-item price source for those
  //     categories yet.
  //   - If the backend's /planner/itinerary response already
  //     includes its own `budgetBreakdown` array, that real
  //     data is used instead and nothing here is estimated.
  // --------------------------------------------------

  type BudgetLine = { label: string; amount: number; note: string };

  function priceLevelToPerNight(level?: string): number | null {
    switch (level) {
      case "PRICE_LEVEL_INEXPENSIVE":
        return 1150;
      case "PRICE_LEVEL_MODERATE":
        return 2500;
      case "PRICE_LEVEL_EXPENSIVE":
        return 5250;
      case "PRICE_LEVEL_VERY_EXPENSIVE":
        return 8000;
      default:
        return null;
    }
  }

  function computeBudgetBreakdown(): BudgetLine[] | null {
    if (!itinerary || !totalBudget || !days) return null;

    // Prefer a real breakdown straight from the backend if it sends one
    if (
      Array.isArray(itinerary.budgetBreakdown) &&
      itinerary.budgetBreakdown.length > 0
    ) {
      return itinerary.budgetBreakdown.map((b: any) => ({
        label: b.label,
        amount: b.amount,
        note: b.note || ""
      }));
    }

    const allStops = (itinerary.itinerary || []).flatMap(
      (d: any) => d.stops || []
    );

    const stayStop = allStops.find(
      (s: any) =>
        s.place?.priceLevel &&
        (s.place?.types?.includes?.("lodging") ||
          /stay|homestay|hotel|resort|lodge/i.test(
            s.place?.displayName?.text || ""
          ))
    );

    const stayPerNight = stayStop
      ? priceLevelToPerNight(stayStop.place.priceLevel)
      : null;

    const stayTotal = stayPerNight
      ? Math.min(stayPerNight * days, totalBudget)
      : Math.round(totalBudget * 0.3);

    const remaining = Math.max(totalBudget - stayTotal, 0);

    const foodTotal = Math.round(remaining * 0.42);
    const transportTotal = Math.round(remaining * 0.25);
    const miscTotal = Math.max(
      remaining - foodTotal - transportTotal,
      0
    );

    const perDay = (amount: number) => Math.round(amount / days);

    return [
      {
        label: stayStop
          ? `Stay — ${stayStop.place.displayName?.text}`
          : "Stay",
        amount: stayTotal,
        note: stayPerNight
          ? `₹${stayPerNight.toLocaleString("en-IN")}/night × ${days}`
          : `Estimated · ${days} night(s)`
      },
      {
        label: "Food",
        amount: foodTotal,
        note: `₹${perDay(foodTotal).toLocaleString("en-IN")}/day × ${days}`
      },
      {
        label: "Local transport",
        amount: transportTotal,
        note: `₹${perDay(transportTotal).toLocaleString(
          "en-IN"
        )}/day × ${days}`
      },
      {
        label: "Misc / entry fees",
        amount: miscTotal,
        note: `₹${perDay(miscTotal).toLocaleString("en-IN")}/day × ${days}`
      }
    ];
  }

  async function downloadForOffline() {
    if (!dest) {
      setMessage("Select a destination first.");
      return;
    }

    setOfflineDownloading(true);
    setMessage("⏳ Downloading this trip for offline use…");

    // Store the complete trip snapshot first. This is what the destination
    // screen reads when the network is unavailable.
    const snapshot = {
      destination: dest,
      itinerary,
      nearby,
      routes,
      weather,
      downloadedAt: Date.now()
    };
    localStorage.setItem("tg_offline_destination", JSON.stringify(snapshot));

    try {
      if (!("serviceWorker" in navigator) || !("caches" in window)) {
        throw new Error("Offline storage is unavailable in this browser");
      }

      // Make sure the service worker is registered and controlling this page.
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) throw new Error("Service worker is not active");

      // Cache every same-origin resource that is already loaded by the app.
      // We cache both the exact URL and the URL without Vite/HMR query strings,
      // so the saved app can be reopened after the network is switched off.
      const cache = await caches.open("tourism-guardian-v5");
      const resources = Array.from(new Set(
        performance.getEntriesByType("resource")
          .map((entry: any) => entry.name as string)
          .filter((url: string) => url.startsWith(window.location.origin))
          .concat([
            `${window.location.origin}/`,
            `${window.location.origin}/index.html`,
            `${window.location.origin}/destination`,
            `${window.location.origin}/profile`,
            `${window.location.origin}/manifest.webmanifest`,
            `${window.location.origin}/sw.js`
          ])
      ));

      let cachedCount = 0;
      for (const raw of resources) {
        try {
          const url = new URL(raw);
          if (url.origin !== window.location.origin) continue;

          const response = await fetch(url.href, { cache: "no-store" });
          if (!response.ok) continue;
          await cache.put(url.href, response.clone());

          // Also save a clean URL. Vite dev mode can append timestamps/query
          // parameters, but offline navigation needs the clean module URL.
          if (url.search || url.hash) {
            url.search = "";
            url.hash = "";
            await cache.put(url.href, response.clone());
          }
          cachedCount++;
        } catch (_) {
          // One unavailable resource must not prevent the remaining app from
          // being downloaded.
        }
      }

      // Ask the service worker to warm its own cache as well. This also keeps
      // production/preview builds working with the same offline mechanism.
      registration.active.postMessage({
        type: "CACHE_OFFLINE",
        urls: resources
      });

      // Verify the most important offline files before telling the user that
      // the download succeeded.
      const hasHome = !!(await cache.match("/"));
      const hasIndex = !!(await cache.match("/index.html"));
      const hasMain = resources.some(raw => {
        try {
          const u = new URL(raw);
          return /\/src\/main\.tsx$|\/assets\/index-.*\.js$/.test(u.pathname);
        } catch { return false; }
      });

      if (!hasHome && !hasIndex) throw new Error("App shell was not cached");
      if (cachedCount < 1 && !hasMain) throw new Error("App resources were not cached");

      localStorage.setItem("tg_offline_ready", "true");
      localStorage.setItem("tg_offline_downloaded_at", String(Date.now()));
      setOfflineReady(true);
      setMessage("✓ Downloaded successfully. This trip is ready to use offline even when the network is off.");
    } catch (error) {
      console.error("Offline download failed", error);
      setOfflineReady(false);
      localStorage.removeItem("tg_offline_ready");
      setMessage("⚠️ Offline download could not complete. Keep the network on and tap Download for offline again.");
    } finally {
      setOfflineDownloading(false);
    }
  }

  useEffect(() => {
    if (view !== "destination") return;
    const cached = JSON.parse(localStorage.getItem("tg_offline_destination") || "null");
    if (cached?.destination && (!navigator.onLine || !initialDestination)) {
      setDest(cached.destination);
      if (cached.itinerary) setItinerary(cached.itinerary);
      if (cached.nearby) setNearby(cached.nearby);
      if (cached.routes) setRoutes(cached.routes);
      if (cached.weather) setWeather(cached.weather);
      setMessage("Offline mode: using your pre-downloaded trip data.");
    }
  }, [view]);

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="app">

      {/* HEADER */}
      <header>
        <div>
          <b>🛡️ Tourism Guardian</b>

          <small>
            Explore Freely. Travel Safely.
          </small>
        </div>

        <div className="header-actions">
          <button onClick={() => navigate("/")}>{t("home")}</button>
          <button onClick={() => navigate("/profile")}>👤 {t("profile")}</button>
          <select value={language} onChange={e => setLanguage(e.target.value)} aria-label="Language">
            <option value="en">English</option>
            <option value="te">తెలుగు</option>
            <option value="hi">हिन्दी</option>
          </select>
          <span>{user?.name}</span>
          <button onClick={() => useAuth.getState().logout()}>{t("logout")}</button>
        </div>
      </header>

      <main>

        {/* LIVE RISK SCORE + HAZARDS */}
        <section className="card risk-card">
          <div className="risk-head">
            <div>
              <h2 style={{margin:"0 0 5px"}}>🛡️ Travel Risk Score</h2>
              <p className="muted" style={{margin:0}}>Based on current weather, battery, connectivity and route conditions.</p>
            </div>
            <div className={`risk-badge ${risk.level.toLowerCase()}`}>{risk.score}/100 · {risk.level}</div>
          </div>
          <div className="risk-bar"><div style={{width:`${risk.score}%`}} /></div>
          {risk.hazards.length > 0 ? (
            <div className="hazards">
              <b>⚠️ Current hazards</b>
              {risk.hazards.map((h,i)=><span key={i}>• {h}</span>)}
            </div>
          ) : <p className="muted" style={{marginBottom:0}}>No major hazards detected right now.</p>}
        </section>

        {/* LIVE ALERTS — battery / weather / off-route */}
        {alerts.length > 0 && (

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              marginBottom: "18px"
            }}
          >

            {alerts.map((a) => (

              <div
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background:
                    a.severity === "critical" ? "#4c0519" : "#422006",
                  border: `1px solid ${
                    a.severity === "critical" ? "#f43f5e" : "#f59e0b"
                  }`,
                  color: "#fff"
                }}
              >

                <span style={{ fontWeight: 600 }}>{a.message}</span>

                <div
                  style={{
                    display: "flex",
                    gap: "14px",
                    alignItems: "center"
                  }}
                >

                  {a.id === "route" && (
                    <button
                      onClick={recalculateRoute}
                      style={{
                        color: "#fff",
                        fontWeight: 700,
                        background: "rgba(255,255,255,0.15)",
                        border: "none",
                        borderRadius: "6px",
                        padding: "6px 10px",
                        cursor: "pointer"
                      }}
                    >
                      {a.actionLabel || "Recalculate"}
                    </button>
                  )}

                  <button
                    onClick={() => dismissAlert(a.id)}
                    style={{
                      color: "#fff",
                      background: "none",
                      border: "none",
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    ✕
                  </button>

                </div>

              </div>

            ))}

          </div>

        )}

        {view === "home" && <>
        {/* SEARCH */}
        <section className="hero card">

          <h1>
            Where do you want to go?
          </h1>

          <div className="search">

            <input
              value={q}
              onChange={(e) =>
                setQ(e.target.value)
              }
              onKeyDown={(e) =>
                e.key === "Enter" && search()
              }
              placeholder="Search any real place..."
            />

            <button
              className="primary"
              onClick={search}
            >
              Search
            </button>

          </div>

          <select
            onChange={(e) =>
              e.target.value &&
              selectState(e.target.value)
            }
          >

            <option>
              Select Indian state / UT for discovery
            </option>

            {states.map((s) => (
              <option key={s}>
                {s}
              </option>
            ))}

          </select>

        </section>


        {/* LIVE RECOMMENDATIONS */}
        {recommendations.length > 0 && (

          <section className="card">

            <h2>
              ⭐ Live recommendations
            </h2>

            <div className="results">

              {recommendations.map((p) => (

                <button
                  key={p.id}
                  onClick={() =>
                    selectDestination(p)
                  }
                >

                  <b>
                    {p.displayName?.text}
                  </b>

                  <span>
                    {p.formattedAddress}
                  </span>

                </button>

              ))}

            </div>

          </section>

        )}


        {/* SEARCH RESULTS */}
        {results.length > 0 && (

          <section className="card">

            <h2>
              Real places
            </h2>

            <div className="results">

              {results.map((p) => (

                <button
                  key={p.id}
                  onClick={() =>
                    selectDestination(p)
                  }
                >

                  <b>
                    {p.displayName?.text}
                  </b>

                  <span>
                    {p.formattedAddress}
                  </span>

                  {p.rating && (
                    <span>
                      ⭐ {p.rating}
                    </span>
                  )}

                </button>

              ))}

            </div>

          </section>

        )}


        </>}

        {view === "destination" && <>
        {/* MAP + LIVE STATUS */}
        <div className="grid">

          <section className="card" ref={mapSectionRef}>

            <h2>
              📍 Live map
            </h2>

            <MapView
              location={loc}
              destination={
                dest
                  ? {
                      lat:
                        dest.location.latitude,
                      lng:
                        dest.location.longitude
                    }
                  : undefined
              }
              routes={routes}
              selectedRoute={selectedRoute}
              // nearby hotels/hospitals/police/train as tappable pins
              places={nearby
                .filter((p) => p?.location)
                .map((p) => ({
                  id: p.id,
                  lat: p.location.latitude,
                  lng: p.location.longitude,
                  name: p.displayName?.text || "Place",
                  category: nearbyType,
                  address: p.formattedAddress
                }))}
              // tapping a pin computes + draws the real route to it
              onPlaceClick={(mapPlace) => {
                const original = nearby.find(
                  (p) => p.id === mapPlace.id
                );
                if (original) navigateToNearbyPlace(original);
              }}
            />

            <p className="muted">

              {loc
                ? `GPS accuracy: ${Math.round(
                    loc.accuracy
                  )} m`
                : "Waiting for real device GPS permission..."
              }

            </p>

          </section>


          {/* LIVE STATUS */}
          <section className="card">

            <h2>
              🛡️ Live status
            </h2>

            <LiveStatus
              battery={battery}
              online={online}
            />

            <div className="weather">

              {weather ? (

                <>
                  <b>
                    🌦️{" "}
                    {Math.round(
                      weather.temperature
                    )}°C
                  </b>

                  <span>
                    {weather.condition}
                  </span>

                  <small>
                    Updated:{" "}
                    {new Date(
                      weather.updatedAt
                    ).toLocaleTimeString()}
                  </small>
                </>

              ) : (

                <span>
                  Live weather unavailable
                </span>

              )}

            </div>

            <div className="actions">

              <button
                onClick={() =>
                  nearbySearch("hospital")
                }
              >
                🏥 Hospitals
              </button>

              <button
                onClick={openPoliceStations}
              >
                👮 Police
              </button>

              <button
                onClick={() =>
                  nearbySearch("hotel")
                }
              >
                🏨 Hotels
              </button>

              <button
                onClick={openTransportStations}
              >
                🚆 Transport
              </button>

            </div>

          </section>

        </div>


        {/* DESTINATION + ROUTES */}
        {dest && (

          <section className="card">

            <h2>
              🧭{" "}
              {dest.displayName?.text}
            </h2>

            <p>
              {dest.formattedAddress}
            </p>

            <button className="offline-btn" onClick={downloadForOffline} disabled={offlineDownloading}>
              📥 {offlineDownloading ? "Downloading…" : offlineReady ? "Downloaded for offline" : t("download")}
            </button>
            {offlineReady && (
              <div className="offline-success">
                ✓ Downloaded successfully — this trip and the app are saved for offline use.
              </div>
            )}

            <button
              className="primary"
              onClick={startJourney}
            >
              START JOURNEY WITH REAL GPS
            </button>


            {/* ROUTES */}
            {routes.length > 0 && (

              <div
                style={{
                  marginTop: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}
              >

                {routes.map((r, i) => (

                  <button
                    key={i}
                    onClick={() =>
                      setSelectedRoute(i)
                    }
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "7px",
                      width: "100%",
                      padding: "18px",
                      border:
                        i === selectedRoute
                          ? "2px solid #0088cc"
                          : "1px solid #cbd5e1",
                      borderRadius: "14px",
                      background:
                        i === selectedRoute
                          ? "#eaf7ff"
                          : "#ffffff",
                      color: "#071525",
                      cursor: "pointer",
                      textAlign: "left",
                      boxSizing: "border-box",
                      boxShadow:
                        "0 2px 8px rgba(0,0,0,0.08)"
                    }}
                  >

                    <strong
                      style={{
                        color: "#071525",
                        fontSize: "19px",
                        fontWeight: 800
                      }}
                    >
                      🛣️ Route {i + 1}
                    </strong>

                    <span
                      style={{
                        color: "#172033",
                        fontSize: "16px",
                        fontWeight: 600
                      }}
                    >
                      📍{" "}
                      {(
                        r.distanceMeters /
                        1000
                      ).toFixed(1)}{" "}
                      km
                    </span>

                    <span
                      style={{
                        color: "#263548",
                        fontSize: "14px",
                        fontWeight: 500
                      }}
                    >
                      🚗 Traffic-aware:{" "}
                      {Math.round(
                        Number.parseFloat(
                          String(r.duration).replace(
                            "s",
                            ""
                          )
                        ) / 60
                      )}{" "}
                      min
                    </span>

                    <span
                      style={{
                        color: "#263548",
                        fontSize: "14px",
                        fontWeight: 500
                      }}
                    >
                      🛣️ Normal:{" "}
                      {Math.round(
                        Number.parseFloat(
                          String(
                            r.staticDuration
                          ).replace("s", "")
                        ) / 60
                      )}{" "}
                      min
                    </span>

                    <strong
                      style={{
                        color: "#047857",
                        fontSize: "15px",
                        fontWeight: 800,
                        marginTop: "3px"
                      }}
                    >
                      🛡️{" "}
                      {r.safetyScore}/100 —{" "}
                      {r.safetyLabel}
                    </strong>

                  </button>

                ))}

              </div>

            )}

          </section>

        )}


        {/* JOURNEY SAFETY */}
        {journey && (

          <section className="card">

            <h2>
              🛡️ Journey Safety Mode
            </h2>

            <p>
              Real GPS tracking is active only
              for this consented journey.
            </p>

            <div className="danger-row">

              <button
                className="sos"
                onClick={sendSOS}
              >
                🚨 SEND SOS
              </button>

              <button
                onClick={() =>
                  api
                    .patch(
                      `/journeys/${journey._id}/end`
                    )
                    .then(() => {

                      setJourney(null);
                      setRoutes([]);

                      setMessage(
                        "Journey ended."
                      );

                    })
                }
              >
                END JOURNEY
              </button>

              <button
                onClick={() =>
                  startHandshake(
                    "SAFETY CHECK"
                  )
                }
              >
                🛡️ TEST SAFETY CHECK
              </button>

            </div>

          </section>

        )}


        {/* NEARBY PLACES POPUP (Hospitals / Hotels) */}
        {showNearbyModal && (

          <div
            className="modal"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(4, 10, 24, 0.92)",
              zIndex: 3000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              overflowY: "auto"
            }}
          >

            <div
              className="card"
              style={{
                width: "100%",
                maxWidth: "560px",
                maxHeight: "85vh",
                overflowY: "auto"
              }}
            >

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <h2 style={{ margin: 0 }}>
                  Nearby: {nearbyType}
                </h2>

                <button onClick={() => setShowNearbyModal(false)}>
                  ✕ Close
                </button>
              </div>

              {nearby.length === 0 && (
                <p className="muted">No results found nearby.</p>
              )}

              <div className="results">

                {nearby.map((p) => {
                  const isHotel = nearbyType === "hotel";
                  const isExpanded = expandedPlaceId === p.id;

                  return (
                    <div
                      key={p.id}
                      className="place"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        width: "100%"
                      }}
                    >

                      {/* for hotels, tapping the name toggles price info
                          instead of navigating immediately */}
                      <button
                        onClick={() =>
                          isHotel
                            ? setExpandedPlaceId(isExpanded ? null : p.id)
                            : navigateToNearbyPlace(p)
                        }
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "4px",
                          width: "100%",
                          textAlign: "left"
                        }}
                      >
                        <b>{p.displayName?.text}</b>
                        <span>{p.formattedAddress}</span>
                        {p.rating && <span>⭐ {p.rating}</span>}
                      </button>

                      {/* per-day price, shown only for hotels once tapped */}
                      {isHotel && isExpanded && (
                        <div
                          style={{
                            background: "#0b1728",
                            padding: "10px 12px",
                            borderRadius: "8px"
                          }}
                        >
                          {renderPriceInfo(p)}
                        </div>
                      )}

                      {p.nationalPhoneNumber && (
                        <a href={`tel:${p.nationalPhoneNumber}`}>CALL</a>
                      )}

                      {/* Separate action — always navigates, regardless of category */}
                      <button
                        onClick={() => navigateToNearbyPlace(p)}
                        style={{
                          alignSelf: "flex-start",
                          color: "#0088cc",
                          fontWeight: 700,
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer"
                        }}
                      >
                        🧭 Tap to navigate
                      </button>

                    </div>
                  );
                })}

              </div>

            </div>

          </div>

        )}


        {/* POLICE / TRANSPORT DEDICATED SCREEN */}
        {stationScreen && (

          <div
            className="modal"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(4, 10, 24, 0.95)",
              zIndex: 3100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              overflowY: "auto"
            }}
          >

            <div
              className="card"
              style={{
                width: "100%",
                maxWidth: "720px",
                maxHeight: "90vh",
                overflowY: "auto"
              }}
            >

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <h2 style={{ margin: 0 }}>
                  {stationScreen === "police"
                    ? "👮 Nearest Police Stations"
                    : "🚉 Nearest Transport (Railway & Bus)"}
                </h2>

                <button onClick={closeStationScreen}>
                  ✕ Close
                </button>
              </div>

              {stationLoading && (
                <p className="muted">
                  Fetching live{" "}
                  {stationScreen === "police"
                    ? "police stations"
                    : "railway stations and bus stands"}
                  ...
                </p>
              )}

              {!stationLoading && stationResults.length === 0 && (
                <p className="muted">
                  No{" "}
                  {stationScreen === "police"
                    ? "police stations"
                    : "railway stations or bus stands"}{" "}
                  found nearby.
                </p>
              )}

              {/* MAP TO NEAREST STATION */}
              {stationResults.length > 0 && (

                <div style={{ marginTop: "14px", marginBottom: "18px" }}>

                  <MapView
                    location={loc}
                    destination={
                      stationResults[0]?.location
                        ? {
                            lat: stationResults[0].location.latitude,
                            lng: stationResults[0].location.longitude
                          }
                        : undefined
                    }
                    routes={nearestRoute}
                    selectedRoute={0}
                    places={stationResults
                      .filter((p) => p.location)
                      .map((p) => ({
                        id: p.id,
                        lat: p.location.latitude,
                        lng: p.location.longitude,
                        name:
                          p.displayName?.text ||
                          (p._kind === "bus"
                            ? "Bus stand"
                            : p._kind === "train"
                            ? "Railway station"
                            : "Police station"),
                        category: stationScreen,
                        address: p.formattedAddress
                      }))}
                    onPlaceClick={(mapPlace) => {
                      const original = stationResults.find(
                        (p) => p.id === mapPlace.id
                      );
                      if (original) fetchRouteToStation(original);
                    }}
                  />

                  <p className="muted" style={{ marginTop: "6px" }}>
                    {nearestRouteLoading
                      ? "Calculating route…"
                      : nearestRoute[0]
                      ? `🧭 ${(
                          nearestRoute[0].distanceMeters / 1000
                        ).toFixed(1)} km, ~${Math.round(
                          Number.parseFloat(
                            String(nearestRoute[0].duration).replace(
                              "s",
                              ""
                            )
                          ) / 60
                        )} min by road`
                      : "Live route data unavailable"}
                  </p>

                </div>

              )}

              {/* LIST — sorted nearest first */}
              <div
                className="results"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px"
                }}
              >

                {stationResults.map((p, i) => (

                  <div
                    key={p.id}
                    className="place"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      width: "100%",
                      border:
                        i === 0
                          ? "2px solid #0088cc"
                          : "1px solid #334155",
                      borderRadius: "10px",
                      padding: "12px"
                    }}
                  >

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: "8px",
                        flexWrap: "wrap"
                      }}
                    >
                      <b>
                        {p._kind === "bus"
                          ? "🚌 "
                          : p._kind === "train"
                          ? "🚉 "
                          : "👮 "}
                        {p.displayName?.text}
                        {i === 0 && (
                          <span
                            style={{
                              marginLeft: "8px",
                              fontSize: "12px",
                              color: "#0088cc",
                              fontWeight: 700
                            }}
                          >
                            NEAREST
                          </span>
                        )}
                      </b>

                      {typeof p._distanceKm === "number" && (
                        <span
                          style={{
                            fontWeight: 700,
                            color: "#38bdf8"
                          }}
                        >
                          {p._distanceKm.toFixed(1)} km away
                        </span>
                      )}
                    </div>

                    <span>{p.formattedAddress}</span>

                    <div
                      style={{
                        display: "flex",
                        gap: "16px",
                        marginTop: "6px",
                        flexWrap: "wrap",
                        alignItems: "center"
                      }}
                    >
                      {p.nationalPhoneNumber ? (
                        <a
                          href={`tel:${p.nationalPhoneNumber}`}
                          style={{
                            color: "#22c55e",
                            fontWeight: 700,
                            textDecoration: "none"
                          }}
                        >
                          📞 {p.nationalPhoneNumber}
                        </a>
                      ) : (
                        <span className="muted">
                          No contact number in live data
                        </span>
                      )}

                      <button
                        onClick={() => fetchRouteToStation(p)}
                        style={{
                          color: "#0088cc",
                          fontWeight: 700,
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer"
                        }}
                      >
                        🗺️ Show route here
                      </button>

                      <button
                        onClick={() => {
                          navigateToNearbyPlace(p);
                          closeStationScreen();
                        }}
                        style={{
                          color: "#0088cc",
                          fontWeight: 700,
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer"
                        }}
                      >
                        🧭 Navigate on main map
                      </button>
                    </div>

                  </div>

                ))}

              </div>

            </div>

          </div>

        )}


        {/* TRIP PACKAGES — simplified: destination + days + total budget only */}
        <section className="card packages-card">

          <h2>
            🧳 {t("plan")}
          </h2>

          <p className="muted" style={{ marginTop: 0 }}>
            {dest
              ? `Destination: ${dest.displayName?.text}`
              : "Search and select a destination above first."}
          </p>

          <div className="package-form">

            <label>
              Number of days
              <input
                type="number"
                min="1"
                value={days}
                onChange={(e) =>
                  setDays(Math.max(1, Number(e.target.value)))
                }
              />
            </label>

            <label>
              Total budget (₹, for the whole trip, 1 person)
              <input
                type="number"
                min="0"
                value={totalBudget || ""}
                placeholder="e.g. 15000"
                onChange={(e) =>
                  setTotalBudget(Number(e.target.value))
                }
              />
            </label>

          </div>

          {totalBudget > 0 && days > 0 && (
            <p className="muted" style={{ marginTop: "4px" }}>
              ≈ ₹{perDayBudget.toLocaleString("en-IN")} / day
            </p>
          )}

          <button
            className="primary"
            onClick={buildItinerary}
            disabled={itineraryLoading}
          >
            {itineraryLoading
              ? "Generating…"
              : "Generate day-wise package"}
          </button>

          {itinerary && (

            <div className="itinerary" style={{ marginTop: "20px" }}>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "12px"
                }}
              >
                <h3 style={{ margin: 0 }}>
                  {days}-Day Package · {dest?.displayName?.text}
                </h3>

                <span style={{ fontWeight: 800 }}>
                  Total: ₹{totalBudget.toLocaleString("en-IN")}
                </span>
              </div>

              {itinerary.itinerary.map((d: any) => {
                const dayDistanceKm = d.stops.reduce(
                  (sum: number, s: any) =>
                    sum +
                    (s.routeFromPrevious
                      ? s.routeFromPrevious.distanceMeters / 1000
                      : 0),
                  0
                );

                return (

                  <article
                    key={d.day}
                    style={{
                      border: "1px solid #334155",
                      borderRadius: "12px",
                      padding: "16px",
                      marginBottom: "12px"
                    }}
                  >

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginBottom: "10px"
                      }}
                    >
                      <h4 style={{ margin: 0 }}>
                        📅 Day {d.day}
                      </h4>

                      <span style={{ fontWeight: 700, color: "#047857" }}>
                        ₹{perDayBudget.toLocaleString("en-IN")} budget
                        {dayDistanceKm > 0 &&
                          ` · ${dayDistanceKm.toFixed(0)} km`}
                      </span>
                    </div>

                    {d.stops.length === 0 && (
                      <p className="muted">
                        No places returned for this day — try a broader
                        destination or fewer days.
                      </p>
                    )}

                    {d.stops.map((s: any) => (

                      <div className="place" key={s.place.id}>

                        <b>📍 {s.place.displayName?.text}</b>

                        <span>{s.place.formattedAddress}</span>

                        {s.time && <small>⏰ {s.time}</small>}
                        {s.duration && <small>⌛ {s.duration}</small>}
                        {s.tip && <small className="muted">💡 {s.tip}</small>}

                        {s.routeFromPrevious && (
                          <small>
                            🚗{" "}
                            {Math.round(
                              s.routeFromPrevious.distanceMeters / 1000
                            )}{" "}
                            km from previous stop
                          </small>
                        )}

                      </div>

                    ))}

                  </article>

                );
              })}

            </div>

          )}

          {/* BUDGET PLANNING — Estimated cost (per person) */}
          {(() => {
            const budgetLines = computeBudgetBreakdown();
            if (!budgetLines) return null;

            return (
              <div
                style={{
                  marginTop: "18px",
                  background: "#0b1f24",
                  borderRadius: "14px",
                  padding: "20px",
                  color: "#fff"
                }}
              >
                <h3 style={{ margin: "0 0 14px 0" }}>
                  💰 Estimated cost (per person)
                </h3>

                {budgetLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 0",
                      borderBottom:
                        i < budgetLines.length - 1
                          ? "1px solid rgba(255,255,255,0.12)"
                          : "none"
                    }}
                  >
                    <span>{line.label}</span>
                    <span style={{ fontWeight: 700, textAlign: "right" }}>
                      {line.note}
                    </span>
                  </div>
                ))}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "10px",
                    paddingTop: "12px",
                    borderTop: "1px solid rgba(255,255,255,0.25)"
                  }}
                >
                  <span style={{ color: "#f59e0b", fontWeight: 800 }}>
                    Total (your budget)
                  </span>
                  <span style={{ color: "#f59e0b", fontWeight: 800 }}>
                    ₹{totalBudget.toLocaleString("en-IN")}
                  </span>
                </div>

                <p
                  className="muted"
                  style={{ marginTop: "10px", marginBottom: 0 }}
                >
                  {itinerary?.budgetBreakdown
                    ? "Cost split returned by the planner for this destination."
                    : "Rough planning estimate for a hardcoded demo — real per-item prices need a hotel/food/transport pricing API connected on the backend."}
                </p>
              </div>
            );
          })()}

          <p className="muted">
            Live hotel/transport prices are
            not invented. Configure genuine
            providers to display live
            prices/availability.
          </p>

        </section>


        {/* SAFETY MODAL */}
        {handshake && (

          <div className="modal">

            <div className="card">

              <h2>
                ⚠️ Are you OK?
              </h2>

              <p>
                Possible safety event detected.
                Respond within{" "}
                {countdown} seconds.
              </p>

              <button
                className="primary"
                onClick={cancelHandshake}
              >
                I'M SAFE
              </button>

              <button
                className="sos"
                onClick={escalateHandshake}
              >
                GET HELP
              </button>

            </div>

          </div>

        )}

        </>}

      </main>

      {/* PERSISTENT SOS — always available, not just once a
          journey has started. sendSOS already works with or
          without an active journey (journeyId is optional). */}
      <button
        onClick={sendSOS}
        title="Send SOS with your live location"
        style={{
          position: "fixed",
          right: "20px",
          bottom: "24px",
          zIndex: 4000,
          background: "#dc2626",
          color: "#fff",
          border: "none",
          borderRadius: "999px",
          padding: "16px 22px",
          fontWeight: 800,
          fontSize: "15px",
          boxShadow: "0 6px 18px rgba(220,38,38,0.5)",
          cursor: "pointer"
        }}
      >
        🚨 SOS
      </button>

    </div>
  );
}