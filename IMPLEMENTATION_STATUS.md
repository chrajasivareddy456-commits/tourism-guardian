# Tourism Guardian implementation status

## Implemented in this package
- Real consented browser GPS via `watchPosition()`.
- Journey-only backend location updates.
- Real Google Places (New) search and nearby discovery.
- Any-location search and Indian 28-state + 8-UT discovery queries.
- Real Google Routes traffic-aware alternative routes.
- Calculated route safety score using available traffic, weather, and configured restricted-zone exposure.
- Route deviation architecture and live journey location pipeline.
- Google Roads nearest-road integration.
- Real OpenWeather integration.
- Real battery/network capability reporting with unsupported fallbacks.
- Local possible-impact heuristic and 15-second Guardian Handshake.
- Automatic possible-emergency escalation to backend and authority dashboard.
- Optional real trusted-contact webhook integration; no fake notification is claimed when absent.
- Polygon/MultiPolygon restricted-zone geofencing from MongoDB configured data.
- Manual SOS.
- Authenticated Socket.IO authority channel.
- Authority role invite-code protection.
- Real nearby hospital/police/hotel/transport infrastructure via Places.
- Combined user-entered budget + real-place itinerary planner.
- PWA manifest and offline-safe UI fallbacks.

## Provider-dependent by design
- Live hotel room/night pricing: requires a genuine booking/hotel pricing provider.
- Live bus/train/metro/ride availability: requires a genuine transport provider.
- Trusted-contact delivery: requires a configured webhook/notification provider.
- General road-condition feed: Google Roads provides road matching/metadata; it is not a general road-condition API.

The application never substitutes fabricated live values for these unavailable providers.
