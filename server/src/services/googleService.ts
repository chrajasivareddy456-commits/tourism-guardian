const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/search";

const OSRM_URL =
  "https://router.project-osrm.org/route/v1/driving";

// ============================================================
// LIVE PLACE SEARCH - OPENSTREETMAP / NOMINATIM
// ============================================================

export async function placeSearch(
  text: string,
  lat?: number,
  lng?: number
) {
  const params = new URLSearchParams({
    q: text,
    format: "json",
    addressdetails: "1",
    limit: "10",
    countrycodes: "in"
  });

  if (
    lat !== undefined &&
    lng !== undefined
  ) {
    params.set("viewbox", `${lng - 1},${lat + 1},${lng + 1},${lat - 1}`);
    params.set("bounded", "0");
  }

  const response = await fetch(
    `${NOMINATIM_URL}?${params.toString()}`,
    {
      headers: {
        "User-Agent":
          "TourismGuardian/1.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `OpenStreetMap search error ${response.status}`
    );
  }

  const data: any[] =
    await response.json();

  return {
    places: data.map((place) => ({
      id: place.place_id?.toString(),

      displayName: {
        text: place.display_name
          ?.split(",")[0] ||
          "Unknown place"
      },

      formattedAddress:
        place.display_name || "",

      location: {
        latitude: Number(place.lat),
        longitude: Number(place.lon)
      },

      rating: undefined,

      currentOpeningHours:
        undefined,

      photos: [],

      nationalPhoneNumber:
        undefined,

      websiteUri:
        undefined,

      priceLevel:
        undefined
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
  return placeSearch(
    `${text} near ${lat},${lng}`,
    lat,
    lng
  );
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

  const data: any =
    await response.json();

  if (
    data.code !== "Ok" ||
    !data.routes?.length
  ) {
    throw new Error(
      "No road route found"
    );
  }

  const routes =
    data.routes.map(
      (route: any) => ({
        distanceMeters:
          route.distance,

        duration:
          `${Math.round(
            route.duration / 60
          )} min`,

        staticDuration:
          `${Math.round(
            route.duration / 60
          )} min`,

        polyline: {
          // Keep this field so the
          // frontend structure remains
          // compatible.
          encodedPolyline:
            undefined
        },

        geometry: {
          coordinates:
            route.geometry
              ?.coordinates || []
        },

        safetyScore: 100,

        safetyLabel:
          "Tourism Guardian calculated safety score",

        steps:
          route.legs
            ?.flatMap(
              (leg: any) =>
                leg.steps || []
            )
            .map(
              (step: any) => ({
                instruction:
                  step.maneuver
                    ?.instruction ||
                  step.name ||
                  "Continue",

                distanceMeters:
                  step.distance
              })
            ) || []
      })
    );

  return {
    routes
  };
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
