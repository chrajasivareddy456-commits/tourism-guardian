import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Point = {
  lat: number;
  lng: number;
};

type Route = {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;

  polyline?: {
    encodedPolyline?: string;
  };

  geometry?: {
    coordinates?: [number, number][];
  };

  safetyScore?: number;
  safetyLabel?: string;
};

type MapPlace = Point & { id?: string | number; name?: string; category?: string; address?: string };

type Props = {
  location?: Point;
  destination?: Point;
  routes?: Route[];
  selectedRoute?: number;
  places?: MapPlace[];
  onPlaceClick?: (place: MapPlace) => void;
};

// ============================================================
// START ICON
// ============================================================

const startIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width:32px;
      height:32px;
      background:#16a34a;
      border:4px solid white;
      border-radius:50%;
      box-shadow:0 3px 10px rgba(0,0,0,.4);
      display:flex;
      align-items:center;
      justify-content:center;
    ">
      <div style="
        width:10px;
        height:10px;
        background:white;
        border-radius:50%;
      "></div>
    </div>

    <div style="
      background:white;
      color:#111827;
      font-weight:900;
      font-size:11px;
      padding:3px 7px;
      border-radius:5px;
      margin-top:3px;
      box-shadow:0 2px 7px rgba(0,0,0,.3);
      text-align:center;
    ">
      START
    </div>
  `,

  iconSize: [65, 65],
  iconAnchor: [32, 18]
});

// ============================================================
// DESTINATION ICON
// ============================================================

const destinationIcon = L.divIcon({
  className: "",

  html: `
    <div style="
      width:34px;
      height:34px;
      background:#dc2626;
      border:4px solid white;
      border-radius:50%;
      box-shadow:0 3px 10px rgba(0,0,0,.4);
      display:flex;
      align-items:center;
      justify-content:center;
      color:white;
      font-size:17px;
      font-weight:900;
    ">
      ★
    </div>

    <div style="
      background:white;
      color:#dc2626;
      font-weight:900;
      font-size:11px;
      padding:4px 7px;
      border-radius:5px;
      margin-top:3px;
      box-shadow:0 2px 7px rgba(0,0,0,.3);
      white-space:nowrap;
      text-align:center;
    ">
      DESTINATION
    </div>
  `,

  iconSize: [100, 70],
  iconAnchor: [50, 20]
});

// ============================================================
// MAP COMPONENT
// ============================================================

export default function MapView({
  location,
  destination,
  routes = [],
  selectedRoute = 0,
  places = [],
  onPlaceClick
}: Props) {
  const mapContainer =
    useRef<HTMLDivElement>(null);

  const mapRef =
    useRef<any>(null);

  const startMarker =
    useRef<any>(null);

  const destinationMarker =
    useRef<any>(null);

  const placeMarkers = useRef<any[]>([]);

  const routeLayers =
    useRef<any[]>([]);

  // ==========================================================
  // CREATE LEAFLET MAP
  // ==========================================================

  useEffect(() => {
    if (!mapContainer.current) {
      return;
    }

    if (mapRef.current) {
      return;
    }

    const center =
      location ||
      destination || {
        lat: 20.5937,
        lng: 78.9629
      };

    const map = L.map(
      mapContainer.current,
      {
        center: [
          center.lat,
          center.lng
        ],

        zoom:
          location ||
          destination
            ? 13
            : 5,

        zoomControl: true,

        attributionControl: true
      }
    );

    // ========================================================
    // OPENSTREETMAP
    // ========================================================

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,

        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    ).addTo(map);

    mapRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 300);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ==========================================================
  // START MARKER
  // ==========================================================

  useEffect(() => {
    if (
      !mapRef.current ||
      !location
    ) {
      return;
    }

    if (!startMarker.current) {
      startMarker.current =
        L.marker(
          [
            location.lat,
            location.lng
          ],
          {
            icon: startIcon,
            zIndexOffset: 1000
          }
        ).addTo(
          mapRef.current
        );
    } else {
      startMarker.current.setLatLng([
        location.lat,
        location.lng
      ]);
    }
  }, [location]);

  // ==========================================================
  // DESTINATION MARKER
  // ==========================================================

  useEffect(() => {
    if (
      !mapRef.current ||
      !destination
    ) {
      return;
    }

    if (!destinationMarker.current) {
      destinationMarker.current =
        L.marker(
          [
            destination.lat,
            destination.lng
          ],
          {
            icon: destinationIcon,
            zIndexOffset: 2000
          }
        ).addTo(
          mapRef.current
        );
    } else {
      destinationMarker.current.setLatLng([
        destination.lat,
        destination.lng
      ]);
    }
  }, [destination]);

  // ==========================================================
  // NEARBY PLACE MARKERS
  // ==========================================================
  useEffect(() => {
    if (!mapRef.current) return;
    placeMarkers.current.forEach(m => m.remove());
    placeMarkers.current = [];
    places.forEach(place => {
      const marker = L.marker([place.lat, place.lng])
        .addTo(mapRef.current!)
        .bindPopup(`<b>${place.name || "Place"}</b><br/>${place.address || ""}`);
      marker.on("click", () => onPlaceClick?.(place));
      placeMarkers.current.push(marker);
    });
  }, [places, onPlaceClick]);

  // ==========================================================
  // DRAW REAL ROAD ROUTES
  // ==========================================================

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const map =
      mapRef.current;

    // Remove previous route lines
    routeLayers.current.forEach(
      (line) => {
        map.removeLayer(line);
      }
    );

    routeLayers.current = [];

    if (!routes.length) {
      return;
    }

    console.log(
      "REAL OSRM ROUTES:",
      routes
    );

    routes.forEach(
      (route, index) => {
        const coordinates =
          route.geometry
            ?.coordinates;

        if (
          !coordinates ||
          coordinates.length < 2
        ) {
          console.warn(
            `Route ${
              index + 1
            } has no road geometry`
          );

          return;
        }

        // OSRM gives:
        //
        // [longitude, latitude]
        //
        // Leaflet needs:
        //
        // [latitude, longitude]

        const latLngs =
          coordinates.map(
            ([lng, lat]) => [
              lat,
              lng
            ] as [
              number,
              number
            ]
          );

        const isSelected =
          index === selectedRoute;

        // ====================================================
        // ALTERNATIVE ROUTE
        // ====================================================

        if (!isSelected) {
          const alternative =
            L.polyline(
              latLngs,
              {
                color: "#64748b",

                weight: 5,

                opacity: 0.55,

                lineCap: "round",

                lineJoin: "round",

                dashArray:
                  "10 8",

                interactive: false
              }
            ).addTo(map);

          routeLayers.current.push(
            alternative
          );

          return;
        }

        // ====================================================
        // SELECTED ROUTE
        // ====================================================

        // White border underneath
        // makes blue route clearly
        // visible over the map.

        const routeBorder =
          L.polyline(
            latLngs,
            {
              color: "#ffffff",

              weight: 12,

              opacity: 0.95,

              lineCap: "round",

              lineJoin: "round",

              interactive: false
            }
          ).addTo(map);

        routeLayers.current.push(
          routeBorder
        );

        // Actual navigation blue line

        const selectedLine =
          L.polyline(
            latLngs,
            {
              color: "#1976ff",

              weight: 8,

              opacity: 1,

              lineCap: "round",

              lineJoin: "round",

              interactive: true
            }
          ).addTo(map);

        selectedLine.bindTooltip(
          `🛣️ Route ${
            index + 1
          }`,
          {
            sticky: true
          }
        );

        routeLayers.current.push(
          selectedLine
        );

        // ====================================================
        // BLUE DIRECTION DOTS
        // ====================================================

        for (
          let i = 0;
          i < latLngs.length;
          i += Math.max(
            1,
            Math.floor(
              latLngs.length / 35
            )
          )
        ) {
          L.circleMarker(
            latLngs[i],
            {
              radius: 3,

              color: "#ffffff",

              weight: 1,

              fillColor: "#1976ff",

              fillOpacity: 1,

              interactive: false
            }
          ).addTo(map);
        }
      }
    );

  }, [
    routes,
    selectedRoute,
    location,
    destination
  ]);

  // ==========================================================
  // FIT SELECTED ROUTE
  // ==========================================================

  useEffect(() => {
    if (
      !mapRef.current ||
      !routes.length
    ) {
      return;
    }

    const route =
      routes[selectedRoute];

    const coordinates =
      route?.geometry
        ?.coordinates;

    if (
      !coordinates ||
      coordinates.length < 2
    ) {
      return;
    }

    const bounds =
      L.latLngBounds([]);

    coordinates.forEach(
      ([lng, lat]) => {
        bounds.extend([
          lat,
          lng
        ]);
      }
    );

    if (location) {
      bounds.extend([
        location.lat,
        location.lng
      ]);
    }

    if (destination) {
      bounds.extend([
        destination.lat,
        destination.lng
      ]);
    }

    mapRef.current.fitBounds(
      bounds,
      {
        paddingTopLeft: [
          50,
          70
        ],

        paddingBottomRight: [
          50,
          70
        ],

        maxZoom: 15,

        animate: true,

        duration: 1
      }
    );

  }, [
    selectedRoute,
    routes,
    location,
    destination
  ]);

  // ==========================================================
  // MAP RESIZE
  // ==========================================================

  useEffect(() => {
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 300);
  }, [
    location,
    destination
  ]);

  // ==========================================================
  // UI
  // ==========================================================

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "450px",
        minHeight: "450px",
        overflow: "hidden",
        borderRadius: "14px"
      }}
    >
      <div
        ref={mapContainer}
        style={{
          width: "100%",
          height: "100%"
        }}
      />

      {/* ================================================== */}
      {/* LEGEND */}
      {/* ================================================== */}

      {routes.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 1000,

            background: "white",

            padding:
              "12px 15px",

            borderRadius: "10px",

            boxShadow:
              "0 3px 12px rgba(0,0,0,.3)",

            color: "#111827",

            fontSize: "13px",

            fontWeight: 700
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems:
                "center",
              gap: "8px",
              marginBottom: "8px"
            }}
          >
            <span
              style={{
                width: "30px",
                height: "8px",
                background:
                  "#1976ff",
                borderRadius:
                  "5px",
                display: "inline-block"
              }}
            />

            Selected Route
          </div>

          <div
            style={{
              display: "flex",
              alignItems:
                "center",
              gap: "8px"
            }}
          >
            <span
              style={{
                width: "30px",
                height: "5px",
                background:
                  "#64748b",
                borderRadius:
                  "5px",
                display: "inline-block"
              }}
            />

            Alternative
          </div>
        </div>
      )}

      {/* ================================================== */}
      {/* CURRENT ROUTE */}
      {/* ================================================== */}

      {routes.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "12px",
            left: "12px",
            zIndex: 1000,

            background:
              "rgba(255,255,255,.96)",

            padding:
              "8px 12px",

            borderRadius: "8px",

            boxShadow:
              "0 2px 8px rgba(0,0,0,.25)",

            color: "#111827",

            fontWeight: 800,

            fontSize: "13px"
          }}
        >
          🧭 Showing Route{" "}
          {selectedRoute + 1}
        </div>
      )}
    </div>
  );
}