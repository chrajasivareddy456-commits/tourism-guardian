# 🛡️ Tourism Guardian
Explore Freely. Travel Safely.

A real-time tourist safety platform built around consented device GPS, Google Maps Platform, real weather data, Socket.IO emergency events, MongoDB, and a calculated safety/vulnerability engine.

## What is live
- Device geolocation uses `watchPosition()` only while the app is open; Journey Mode sends consented updates to the backend. Browser geolocation requires permission and a secure context (HTTPS in deployment).
- Google Places (New): real place IDs, addresses, ratings/availability fields when returned, phone and website fields when available.
- Google Routes API: traffic-aware routes and alternatives where Google returns them.
- Google Roads API: nearest-road metadata. Roads API does not itself provide a general road-condition feed.
- Weather: OpenWeather current conditions.
- Socket.IO: real emergency events from authenticated users to authenticated authority users.
- Battery/network: real browser signals where supported.
- Fall/impact: local device-motion heuristic; it is explicitly a possible impact signal, never an accident confirmation.

## Live-data boundaries
Hotel nightly prices and bus/train live availability are **not fabricated**. Google Places can provide place/business information and price levels, but a real nightly room-price provider is required for live room rates. A genuine transport provider API is required for live bus/train availability. Until those providers are configured, the UI reports that live data is unavailable.

## Setup
1. Create a MongoDB database.
2. Create a Google Cloud project and enable the Maps JavaScript API, Places API (New), Routes API and Roads API. Routes API requires an API key and billing setup. See the official Google documentation.
3. Create a weather provider API key.
4. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`.
5. Use separate restricted browser/server keys where appropriate. Never commit secrets.
6. From the repository root run `npm install`, then `npm run install:all` and `npm run dev`.

## Security
- JWT authentication
- bcrypt password hashing
- Zod validation
- Helmet
- CORS
- rate limiting
- authority-only Socket.IO room
- server-side Google service key
- authority registration requires a server-side invite code

## Emergency escalation
Guardian Handshake is event-based. A possible impact can open a 15-second local confirmation. If the user does not respond, the backend creates a `UNRESPONSIVE_HANDSHAKE` event and broadcasts it to authorized authority clients. Trusted-contact notification uses the optional `TRUSTED_CONTACT_WEBHOOK_URL`; no fake notification is claimed when it is not configured.

## Important browser limitations
Battery Status API and Network Information API are not available in every browser. Device motion permissions/behavior vary by browser and OS. The app reports unavailable status instead of inventing values.


## Updated travel flow

1. After login, choose a Source using either **Use My Current Location** (browser GPS permission) or a searched place.
2. Search and select a Destination.
3. The app opens the route page. Start a consented journey to enable live tracking and route safety mode.
4. Journey mode calculates available OSRM alternative routes and gives each route a safety score plus a transparent next-30-minute heuristic prediction based on currently available weather/restricted-zone signals.
5. Select a route card; the map shows only that selected route.
6. Filling stations along the selected route are shown on the map during the journey.
7. Hospitals, hotels, police stations and transport can be searched around either the tourist's current location or the selected destination.
8. Famous/local tourist attractions near the destination are shown. Selecting one calculates alternative routes and safety scores to that attraction.
9. SOS requests a fresh GPS position and sends the tourist's coordinates, safety context, selected language and translated emergency message to the authority dashboard.
10. Voice search uses the browser's Speech Recognition API when available.
11. English, Telugu, Hindi and Tamil are available from the language selector.

### Safety-data transparency

The public OSRM service does not provide live traffic congestion. The route score therefore does **not** pretend to contain live traffic data. Likewise, the project currently has no verified scam/pickpocket/harassment incident feed, so those incidents are not fabricated. The predictive indicator is a heuristic using the project's configured safety signals (weather, restricted zones and route factors). A verified incident provider can be added later without changing the user workflow.
