const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/search";

const OSRM_URL =
  "https://router.project-osrm.org/route/v1/driving";

const OPENTRIPMAP_URL =
  "https://api.opentripmap.com/0.1/en/places";

// ============================================================
// LIVE PLACE SEARCH - OPENSTREETMAP / NOMINATIM
// ============================================================

export async function placeSearch(
  text: string,
  lat?: number,
  lng?: number
) {
  // Prefer configured Google Places for richer data; keep OSM as a
  // resilient fallback when the Google service is unavailable.
    const key = process.env.GOOGLE_MAPS_API_KEY;

  if (key && key !== "your_server_side_google_maps_key") {
    try {
      const body: any = {
        textQuery: text,
        languageCode: "en",
        regionCode: "IN",
        maxResultCount: 20
      };

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        body.locationBias = {
          circle: {
            center: {
              latitude: Number(lat),
              longitude: Number(lng)
            },
            radius: 50000
          }
        };
      }

      const response = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": [
              "places.id",
              "places.displayName",
              "places.formattedAddress",
              "places.location",
              "places.rating",
              "places.currentOpeningHours",
              "places.nationalPhoneNumber",
              "places.websiteUri",
              "places.priceLevel",
              "places.types"
            ].join(",")
          },
          body: JSON.stringify(body)
        }
      );

      const responseText = await response.text();

      if (!response.ok) {
        console.error(
          `[placeSearch] Google HTTP ${response.status}:`,
          responseText
        );
      } else {
        const data: any = responseText
          ? JSON.parse(responseText)
          : {};

        const places = (data.places || []).map((place: any) => ({
          id: place.id,
          displayName: {
            text: place.displayName?.text || "Unknown place"
          },
          formattedAddress: place.formattedAddress || "",
          location: place.location
            ? {
                latitude: Number(place.location.latitude),
                longitude: Number(place.location.longitude)
              }
            : undefined,
          rating: place.rating,
          currentOpeningHours: place.currentOpeningHours,
          photos: place.photos || [],
          nationalPhoneNumber: place.nationalPhoneNumber,
          websiteUri: place.websiteUri,
          priceLevel: place.priceLevel,
          types: place.types || []
        }));

        console.log(
          `[placeSearch] Google query="${text}" results=${places.length}`
        );

        if (places.length) {
          return { places };
        }
      }
    } catch (error) {
      console.error("[placeSearch] Google Places error:", error);
    }
  }

  const params = new URLSearchParams({
    q: text, format: "json", addressdetails: "1", limit: "20", countrycodes: "in"
  });
  if (lat !== undefined && lng !== undefined) {
    params.set("viewbox", `${lng - 1},${lat + 1},${lng + 1},${lat - 1}`);
    params.set("bounded", "0");
  }
  const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { "User-Agent": "TourismGuardian/1.0" }
  });
  if (!response.ok) throw new Error(`OpenStreetMap search error ${response.status}`);
  const data: any[] = await response.json();
  return {
    places: data.map((place) => ({
      id: place.place_id?.toString(),
      displayName: { text: place.display_name?.split(",")[0] || "Unknown place" },
      formattedAddress: place.display_name || "",
      location: { latitude: Number(place.lat), longitude: Number(place.lon) },
      rating: undefined, currentOpeningHours: undefined, photos: [],
      nationalPhoneNumber: undefined, websiteUri: undefined, priceLevel: undefined,
      types: place.type ? [place.type] : []
    }))
  };
}

// ============================================================
// NEARBY SEARCH
// ============================================================

export async function nearbySearch(
  text: string,
  lat: number,
  lng: number
) {
  const queries: Record<string, string[]> = {
    police: [
      "police station",
      "police department",
      "police"
    ],
    hospital: [
      "hospital",
      "medical center"
    ],
    hotel: [
      "hotel",
      "hotels"
    ],
    train_station: [
      "railway station",
      "train station"
    ],
    bus_station: [
      "bus station",
      "bus terminal"
    ],
    tourist: [
  "tourist attraction",
  "tourist attractions",
  "places to visit",
  "popular tourist places",
  "points of interest",
  "sightseeing"
]
  };

  const searchQueries = queries[text] || [text];

  for (const query of searchQueries) {
    try {
      const searchText =
  text === "tourist"
    ? `${query}`
    : `${query} near ${lat},${lng}`;

const result = await placeSearch(
  searchText,
  lat,
  lng
);

      if (result?.places?.length) {
        return {
          places: result.places.slice(0, 20)
        };
      }
    }  catch (error) {
  console.error("[placeSearch] Google Places error:", error);
  // Fall through to OSM/Nominatim.
}
  }

  return { places: [] };
}

// ============================================================
// TOURIST ATTRACTIONS - OPENTRIPMAP
// ============================================================
//
// OpenTripMap is a dedicated sightseeing/POI dataset (kinds,
// Wikipedia extracts, images), and unlike the public Overpass
// mirrors used elsewhere, it's a single reliable HTTPS endpoint
// with an API key — no 429/504/aborted-mirror flakiness. Used as
// a point search here; places.ts samples this along a route for
// "along-route-attractions".
// ============================================================

export function openTripMapCategory(kinds: string) {
  const first = (kinds || "").split(",")[0] || "";
  if (first.includes("waterfall")) return "waterfall";
  if (first.includes("view_points")) return "viewpoint";
  if (first.includes("museum")) return "museum";
  if (first.includes("monuments") || first.includes("archaeology") || first.includes("fortifications") || first.includes("historic")) return "historical";
  if (first.includes("religion")) return "temple";
  if (first.includes("gardens_and_parks") || first.includes("natural")) return "park";
  return "tourist";
}

export async function touristAttractionsSearch(
  lat: number,
  lng: number,
  radiusMeters: number = 10000,
  kinds: string = "interesting_places"
) {
  const key = process.env.OPENTRIPMAP_API_KEY;

  if (!key) {
    console.error("[opentripmap] OPENTRIPMAP_API_KEY not set, falling back to placeSearch");
    return placeSearch("tourist attraction", lat, lng);
  }

  try {
    const params = new URLSearchParams({
      radius: String(radiusMeters),
      lon: String(lng),
      lat: String(lat),
      kinds,
      format: "json",
      limit: "20",
      apikey: key
    });

    const response = await fetch(`${OPENTRIPMAP_URL}/radius?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[opentripmap] radius search error ${response.status}: ${body.slice(0, 300)}`);
      return placeSearch("tourist attraction", lat, lng);
    }

    const data: any[] = await response.json();
    const places = data
      .filter((place) => place?.name)
      .map((place) => ({
        id: `opentripmap-${place.xid}`,
        displayName: { text: place.name || "Unknown place" },
        formattedAddress: "",
        location: { latitude: Number(place.point?.lat), longitude: Number(place.point?.lon) },
        rating: place.rate,
        currentOpeningHours: undefined,
        photos: [],
        nationalPhoneNumber: undefined,
        websiteUri: undefined,
        priceLevel: undefined,
        category: openTripMapCategory(place.kinds || ""),
        types: place.kinds ? place.kinds.split(",") : []
      }));

    if (!places.length) return placeSearch("tourist attraction", lat, lng);
    return { places };
  } catch (e: any) {
    console.error(`[opentripmap] radius search request failed: ${e?.message || e}`);
    return placeSearch("tourist attraction", lat, lng);
  }
}

// Fetch rich detail (description, image, Wikipedia extract) for a
// single OpenTripMap place, given its xid (returned as the `-xid`
// suffix of `id` above, e.g. "opentripmap-<xid>").
export async function touristAttractionDetail(xid: string) {
  const key = process.env.OPENTRIPMAP_API_KEY;
  if (!key) throw new Error("OPENTRIPMAP_API_KEY not set");

  const response = await fetch(
    `${OPENTRIPMAP_URL}/xid/${encodeURIComponent(xid)}?apikey=${key}`
  );
  if (!response.ok) {
    throw new Error(`OpenTripMap detail error ${response.status}`);
  }
  return await response.json();
}

// ============================================================
// REAL ROAD ROUTING - OSRM
// ============================================================

export async function computeRoutes(
  origin: {
    lat: number;
    lng: number;
  },
  destination: {
    lat: number;
    lng: number;
  }
) {
  const coordinates =
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

  const url =
    `${OSRM_URL}/${coordinates}` +
    `?alternatives=true` +
    `&steps=true` +
    `&overview=full` +
    `&geometries=geojson`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `OSRM routing error ${response.status}`
    );
  }

  const data: any = await response.json();

  if (
    data.code !== "Ok" ||
    !data.routes?.length
  ) {
    throw new Error("No road route found");
  }

  const routes = data.routes.map(
    (route: any, index: number) => ({
      routeIndex: index,
      distanceMeters: route.distance,
      duration: `${Math.round(route.duration / 60)} min`,
      staticDuration: `${Math.round(route.duration / 60)} min`,

      // Kept for frontend compatibility.
      // OSRM returns GeoJSON geometry below instead.
      polyline: {
        encodedPolyline: undefined
      },

      // OSRM road geometry: [longitude, latitude]
      geometry: {
        coordinates: route.geometry?.coordinates || []
      },

      safetyScore: 100,
      safetyLabel: "Calculating safety...",

      steps: route.legs
        ?.flatMap((leg: any) => leg.steps || [])
        .map((step: any) => {
          const type = String(step.maneuver?.type || "").toLowerCase();
          const modifier = String(step.maneuver?.modifier || "").toLowerCase();
          const road = String(step.name || "").trim();
          let instruction = "Continue";
          if (type === "depart") instruction = road ? `Towards ${road}` : "Start and continue";
          else if (type === "arrive") instruction = "Arrive at your destination";
          else if (type === "roundabout" || type === "rotary") instruction = road ? `Take the roundabout towards ${road}` : "Take the roundabout";
          else if (modifier.includes("left")) instruction = road ? `Turn left onto ${road}` : "Turn left";
          else if (modifier.includes("right")) instruction = road ? `Turn right onto ${road}` : "Turn right";
          else if (type === "new name" || type === "continue") instruction = road ? `Continue towards ${road}` : "Continue straight";
          else if (road) instruction = `Continue towards ${road}`;
          return {
            instruction,
            roadName: road || undefined,
            distanceMeters: step.distance,
            location: step.maneuver?.location
              ? { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] }
              : undefined
          };
        }) || []
    })
  );

  return { routes };
}

// ============================================================
// NEAREST ROAD
// ============================================================
//
// OSRM doesn't provide the same Roads API endpoint.
// For the prototype, return the supplied location.
// ============================================================

export async function nearestRoads(
  lat: number,
  lng: number
) {
  return {
    snappedPoints: [
      {
        location: {
          latitude: lat,
          longitude: lng
        }
      }
    ]
  };
}

// ============================================================
// DISTANCE CALCULATION
// ============================================================

export function haversineMeters(
  a: {
    lat: number;
    lng: number;
  },
  b: {
    lat: number;
    lng: number;
  }
) {
  const R = 6371000;

  const p1 =
    a.lat * Math.PI / 180;

  const p2 =
    b.lat * Math.PI / 180;

  const dp =
    (b.lat - a.lat) *
    Math.PI / 180;

  const dl =
    (b.lng - a.lng) *
    Math.PI / 180;

  const x =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) *
      Math.cos(p2) *
      Math.sin(dl / 2) ** 2;

  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(x)
    )
  );
}

// ============================================================
// HOTEL SEARCH - Google Places when a server key is configured,
// with OpenStreetMap fallback so the app remains usable.
// ============================================================
export async function hotelSearch(lat: number, lng: number) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key && key !== "your_server_side_google_maps_key") {
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.nationalPhoneNumber,places.websiteUri,places.currentOpeningHours"
        },
        body: JSON.stringify({ textQuery: "hotels near me", locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 10000 } }, maxResultCount: 10 })
      });
      if (response.ok) return await response.json();
    } catch {}
  }
  return placeSearch(`hotels near ${lat},${lng}`, lat, lng);
}
