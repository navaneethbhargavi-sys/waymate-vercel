# 🚇 Waymate — Delhi Metro Blue Line prototype

A working mobile-first prototype for your friend's app idea: **fast Blue Line ticket booking + travel buddies (dating/meetup) for metro timepass**.

Everything runs client-side with `localStorage` — no backend needed for the demo. It's structured so the data layer can be swapped for Supabase later.

## Run it

Option 1 — just open the file: double-click `index.html`.

Option 2 — local server (recommended, keeps QR + storage happy):

```
cd waymate
python -m http.server 8123
# open http://localhost:8123
```

## What's inside (mapped to the notebook plan)

| Notebook item | In the prototype |
|---|---|
| Registration: email/phone, name, gender, age, photo | Sign-up flow with demo OTP (`1234`), photo upload + crop |
| Blue Line: starting & destination | All 50 stations (Dwarka Sec 21 ↔ Vaishali / Noida City Centre, both branches), searchable picker |
| Timing of the journey | Departure chips (Now / +15 / +30 / pick time), live "next trains" board, journey duration estimate |
| Type of friend req → male/female | Preference selector (Anyone / Men / Women), two-way gender matching |
| Match two people | Matching engine: route overlap + time window (±45 min) + preference → match % score |
| Faster booking | Profile saved once, smart defaults from last trip, auto fare/time, QR ticket — no counter queue |

## Booking details collected (answer to "booking ke liye kya details?")

Same as a normal DMRC ticket, nothing extra:

1. **From** station
2. **To** station
3. **Number of passengers** (1–6)
4. **Journey type** — single / return (return = fare × 2)
5. **Departure time** (demo issues an instant ticket)
6. **Contact** — captured once at registration
7. **Payment method** — UPI / Card / Wallet (mock)

What makes it faster than the normal way: profile is stored after one-time sign-up, the form is pre-filled with your last trip, fare + travel time are computed automatically (DMRC-style slabs: ₹10/20/30/40/50/60), and the QR ticket is issued in-app — no counter, no queue.

## Matching logic (buddy feature)

Two posts match when:
- Their station paths **overlap by at least one station** (both branches handled — Vaishali ↔ Noida trips connect via Yamuna Bank),
- Departure times are within **±45 minutes**,
- **Both sides' gender preferences** are satisfied.

Score = 55 + overlap stations × 3 + time closeness (+10 bonus for identical from/to), capped at 98%.

Six sample commuters (`js/data.js` → `DEMO_USERS` / `demoPosts()`) are seeded with times relative to "now" so there are always live matches. Chat has demo auto-replies.

## Station data & fares

`js/data.js` holds all stations with approximate distances from Dwarka Sector 21 and interchange lines. Fares use DMRC-style slabs over the **actual path length** (cross-branch trips correctly route through Yamuna Bank). These are estimates, not official data.

## Taking it further (suggested order)

1. **Supabase backend** — replace the `store` wrapper in `js/app.js` with Supabase calls:
   - `users` (id, name, gender, age, photo_url, contact, verified)
   - `tickets` (id, user_id, from_stn, to_stn, pax, type, fare, departs_at, qr_payload, status)
   - `travel_posts` (id, user_id, from_stn, to_stn, departs_at, pref, note)
   - `messages` (id, thread_id, sender_id, text, created_at)
2. **Real OTP + verification** (Supabase phone auth) → enables the verified ✔ badge properly.
3. **Deploy**: drag-drop this folder to [Vercel](https://vercel.com) or `vercel deploy` — it's a static site, zero config.
4. **Important reality check**: real ticketing + payments for Delhi Metro requires DMRC partnership/authorization (gate integration, UTSL). Position this as a prototype/demo, or build the companion/buddy layer + info features first while seeking permission for payments.

## Safety (baked into the UI)

Verified badges, meet-near-staff guidance, report button, no money/OTP sharing warnings. A real dating/meetup feature in India needs stronger moderation, reporting pipelines, and likely women-safety features (e.g., female-only matching defaults) — plan for this before any public launch.


## New social improvements

The updated prototype separates **Discover** from **Buddies**. Discover sends buddy requests and shows request status; Buddies contains accepted connections, an Inbox tab, incoming requests, sent requests, and unread badges. Chats include report and block actions, and all relationship state remains local to the browser for offline demo use.

## Optional Google login setup

The app includes an offline-safe Google Identity Services scaffold. Without configuration, the normal phone/email demo flow continues to work and the Google button explains that a client ID is required. To enable Google sign-in for a deployed web origin:

1. Create a Web OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add the deployed origin to **Authorized JavaScript origins**.
3. Set `GOOGLE_CLIENT_ID` near the top of `js/app.js` to the generated client ID.
4. Keep the Google Identity Services script in `index.html` enabled.
5. For production, validate the returned credential on a server and create a durable user session; the current client-side decoder is for prototype/demo use only.

Google login requires an internet connection. The core demo, messaging prototype, request state, and local safety controls remain usable offline.
