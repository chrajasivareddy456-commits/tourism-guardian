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
