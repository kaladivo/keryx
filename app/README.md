# Keryx — app (reference client)

Reference **client** for the Keryx protocol (see `../spec/`, `../design/` and
the publisher demo in `../demo`). One codebase, four targets:

- **Web** — Expo web (React Native Web + TypeScript)
- **PWA** — installable, offline-capable (custom service worker, `src/sw.ts`)
- **Android** — Expo native app (React Native; FCM + UnifiedPush wake-ups)
- **iOS** — Expo native app (React Native; FCM-over-APNs wake-ups)

It implements the client flow end to end (spec/clients.md §1): QR/paste join
URL → confirm the origin (the only human step, plain ASCII, nothing else on
screen) → pin the root anchor at `/.well-known/keryx/root.json` → read
master-signed `custom.repo_base` → verify the TUF chain (root → timestamp →
snapshot → targets) → per-channel delegated role metadata
(`channels.<name>.json`) → channel consent → fetch followed channel feeds +
private capability feeds → verify **every** item (OLPC canonicalization + Ed25519;
authored channels need the authors-role threshold) → local filtering → offline
cache. Anything that fails verification is **never displayed** (binary rule,
spec/core.md §2), including items that were previously shown. No account, no
PII, no per-user state anywhere.

## Run it

```bash
make demo DEMO_REPO=/tmp/keryx-demo DEMO_KEYS_DIR=/tmp/keryx-demo-keys DEMO_BASE=http://localhost:8000
make serve-demo DEMO_REPO=/tmp/keryx-demo   # serve it at http://localhost:8000 (CORS-enabled)
make app-dev                                # web client (Expo prints the port)
```

Then open the printed URL, tap **Add a company**, and paste the join URL from
`/tmp/keryx-demo/join.txt` (or open the demo join link —
`/tmp/keryx-demo/join/?p=…` — and scan the QR code it renders). The flow:
confirm the origin
`localhost:8000` → choose channels (suggested ones preselected, you tap to
subscribe) → subscribe → verified inbox.

> The demo artifact signs metadata for `http://localhost:8000` (a
> local-dev exception: the app allows HTTP for private feeds on loopback and
> RFC 1918 private addresses, in debug builds only; release Android builds
> permit no cleartext at all via `network_security_config.xml`, see
> `plugins/with-keryx-android.js`). A real deployment uses the company's
> HTTPS origin.
> Debug Android permits cleartext only on localhost, loopback and the emulator
> host (10.0.2.2). To use a LAN demo, set `KERYX_DEV_HOSTS=192.168.1.20`
> during prebuild; only explicit RFC 1918 IPv4 addresses are accepted.

## Deployment

`main` builds and publishes to GitHub Pages automatically
(`.github/workflows/deploy-pages.yml`): https://v1b3coder.github.io/keryx/

The Pages build is a project site, so the workflow sets `EXPO_BASE_URL=/keryx/`
(`experiments.baseUrl` in `app.config.ts`); the manifest's `start_url`,
`scope` and icon URLs are relative (`public/manifest.webmanifest`). The
service worker is bundled by `scripts/build-sw.mjs` (esbuild + a Workbox
precache of the whole `dist/`); it activates immediately and the page reloads
once onto the new build (`src/pwa.ts`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run web` | Expo web dev server |
| `npm run android` / `npm run ios` | Build and run the native app (`expo run:*`) |
| `npm run test` | Vitest protocol + relay tests against the real `../demo` artifacts |
| `npm run typecheck` | TypeScript check of the app, the service worker and the native module's JS |
| `npm run build` | Production PWA export + service worker (`dist/`) |
| `npm run preview` | Serve `dist/` on http://localhost:4173 (local E2E) |
| `npm run icons` | Regenerate PWA icons (`public/icons/`) |

## What's implemented (vs. the spec)

- **Pairing** — join URL parsing (spec/core.md §3: base64url payload `{v,
  channels, private_feeds}` — **no metadata URL**; the root anchor is derived
  from the join origin; unknown members within a known `v` are ignored, an
  unknown `v` refuses to parse); origin confirmation (nothing is fetched from
  an unconfirmed origin, no company name/logo on the screen); TOFU pin + chain
  walk afterwards.
- **Metadata** — full TUF chain in-repo: OLPC canonical JSON verification of
  the root anchor (self-signature + versioned `N.root.json` chain walk, root
  metadata fetched **only** from the well-known anchor), `timestamp.json`,
  `snapshot.json`, `targets.json` and the followed channels' delegated role
  metadata, with per-link signature + hash/length verification (timestamp pins
  snapshot; snapshot pins targets + every channel role), TUF-standard keyid
  verification (keyid = SHA-256 of the canonical key object), and anti-rollback
  via client-side version memory. `consistent_snapshot: true` repos are
  handled (versioned/hash-prefixed fetch with plain-path fallback). Repo base
  comes from the master-signed `custom.repo_base`; cross-origin redirects are
  blocked (at most one canonical http→https / www↔apex hop, spec/core.md §1.2).
  Expired-but-verified
  metadata → cached content kept, retry (expiry ≠ suspension).
  > The spec names `tuf-js` as the standard client; it is Node-only and
  > cannot run in this browser app, so the standard TUF 1.0 client workflow
  > is implemented in-repo.
- **Authorization (spec/repository.md §2)** — channels are delegated TUF
  roles named `channels.<channel>` (roles not starting with `channels.` and
  roles whose paths fall outside their namespace are ignored); optional
  `channels.<channel>.authors` roles are read as item-signature
  authorization (their `keyids`/`threshold` from the verified `targets.json`
  delegation; the role pins no targets); private-feed patterns resolve keyids
  exclusively from their
  per-entry `keys` maps (key publication rule: a keyid without its key object
  is a metadata error → reject); author keyids must not be channel role
  keyids.
- **Public items** — one item per channel per file at
  `channels/<name>/<id>.json`, a
  TUF target pinned by the channel's own role metadata (length + sha256),
  fetched through the TUF target URL and verified byte-exact before parsing.
  The channel role metadata is the index; items absent from it are dropped
  (absence = unpublished).
- **Items (spec/feeds.md §1)** — OLPC canonical bytes with `sig`
  removed; Ed25519; base64url; `id` matched against the path segment;
  dedup by (channel, id); in-place updates
  (content differs → re-verified + replaced, position/read-state kept, marked
  "updated"; signature-only re-signing is not an update); items
  fail verification on a re-fetch are dropped even if previously displayed
  (binary rule); ordering by `date_published` (required).
- **Authors role (spec/feeds.md §2)** — per channel, master-delegated: items
  MUST
  carry `threshold` valid author signatures; missing/insufficient/bad →
  reject, never shown; additional entries (channel-key signatures) are not
  load-bearing. The demo security channel runs 2-of-2 authors.
- **Private feeds (spec/feeds.md §3)** — capability URL (128-bit token)
  matched against an authorized pattern (origin-exact, segment-boundary
  wildcard) **before** subscribing (tampered QR → rejected) and on every sync;
  whole-document verification: `channel` == entry.channel, `url` ==
  fetched URL, Ed25519 over the OLPC canonical JSON of the document with the
  `sig` field removed (threshold per entry), `version` monotonic
  (anti-rollback via version memory), `expires` window (stale → keep
  cache + retry), `expired: true` (or 404/410/pattern removal) closes the feed
  while cached items stay visible; items use the public item format without
  per-item signatures; 1 MB document size limit; HTTPS only
  (loopback exception for the local demo).
- **Identity (spec/core.md §2)** — the app remembers the identity confirmed at
  pairing; `company_name` change → prominent rebranding warning, content
  hidden until re-pair (rescan a fresh QR, same origin); `logo` or
  `logo_sha256` change → one-tap acknowledgement (never silent, never
  auto-accept); name and logo are
  never shown before the chain verifies and always alongside the join origin;
  the logo is either an inline data URL in the master-signed metadata
  (authenticated with it) or a linked URL pinned by the required
  `logo_sha256` (placeholder on mismatch, nothing else affected).
- **Suspension (spec/core.md §4)** — unverifiable root change (validly signed,
  unchainable) → suspended: content rejected, "identity changed; this can mean
  the company's website or signing keys were compromised", offered action is
  **Remove** only — no re-pair prompt. Network errors and malformed anchor
  data are **not** suspension (offline-first: cached content keeps serving).
- **Filtering (spec/feeds.md §1)** — purely local; item `language`
  + free-form `tags` (stored locally, never sent); instant,
  offline.
- **Rendering** — `content_html` parsed into an allowlisted render model
  (`src/lib/richtext.ts`, rendered by `src/ui/RichText.tsx` on every
  platform; scripts, forms, iframes/embeds and content CSS never make it in — the "never asks for a password,
  seed, or code" promise is structural, and stripping CSS is stricter than
  the spec's sandbox: nothing can escape because none is applied), links
  intercepted with their real destination domain shown before opening (no
  auto-open), attachments hash-verified when `sha256` is present, linked
  media loaded only when the remote-media preference allows it, footer
  reminder under the feed.
- **Feed** — full articles inline (big square picture, title, date + tags,
  complete content) — there is no separate detail view; articles are marked
  read when they scroll into view.
- **Offline-first** — local cache of pinned metadata + verified items + media
  bytes (IndexedDB on the web, shared with the service worker; SQLite on the
  apps — `src/lib/db*.ts`); sync on open/foreground and once a minute while
  active when the last attempt is at least five minutes old, plus manual refresh.
- **Wake-ups (relay/SPECIFICATION.md §4.2)** — the app derives the same topic
  as the relay (`keryx/relay/v1|` + OLPC `{company_id, scope_id, h}`), registers
  the installation's WebPush subscription with the relay (§5.3) and keeps the
  followed-topic set in step; the custom service worker receives the decrypted §4
  envelope, parses it strictly, verifies the Ed25519 threshold against the
  topic's exact scope from the company's verified targets, persists the accepted
  `seq` (replay), acks the relay's liveness heartbeat and shows a locally
  authored generic notice — never unverified content. The worker does no TUF
  metadata or content network work: an unverifiable wake-up is recorded for the
  page, which re-verifies with the full TUF state under its recovery
  allowance and owns the content sync. Recovery is metadata-only, followed by
  retrying the signed envelope; it cannot fetch content before verification.
  The persisted allowance is six hours per company, with a global limit of
  one recovery per minute and one in flight. Pending storage holds one envelope
  per company. Ordinary foreground refresh is independent of this allowance.
  The registration is **app-wide**: one
  permission, one push subscription, one relay record holding the union of every
  followed company's topics (see
  [`../design/notifications.md`](../design/notifications.md)). Configure
  `EXPO_PUBLIC_RELAY_URL` and `EXPO_PUBLIC_VAPID_PUBLIC` at build time to enable it;
  without them the app runs exactly as before (polling is the backstop).

**Native transport:** the Android app probes the wake-up transport at startup
and on returning to the foreground (FCM > UnifiedPush > none; iOS: FCM or none). The FCM probe is the real
`GoogleApiAvailability` check; when Google services are present the app subscribes
the Firebase SDK to the union of every followed company's topics (relay spec §6.1,
registry-free and anonymous — the relay never learns the device's FCM token). A
de-Googled device registers with the ntfy UnifiedPush distributor, which delivers
the same §4 envelope through the connector service; the native worker verifies it
against a mirrored verification state, acks, shows the generic notice and queues it
for the JS layer. See
[`../design/notifications.md`](../design/notifications.md) "Transport selection".

## Relay wake-ups (optional)

A production build uses the **staging relay by default**
(`DEFAULT_RELAY_URL`/`DEFAULT_VAPID_PUBLIC` in `src/lib/relay.ts`:
`https://keryx-relay.fly.dev` plus the public half of its
`RELAY_VAPID_PRIVATE`), so the published PWA receives wake-ups with no build
configuration. `EXPO_PUBLIC_RELAY_URL` and `EXPO_PUBLIC_VAPID_PUBLIC` override that — the
local harness build does. Dev and test builds without the variables run without a
relay (polling is the backstop).

For notifications while running `npm run android` or `npm run ios`, put the
staging settings in `app/.env.local` (ignored by git), then restart Expo:

```dotenv
EXPO_PUBLIC_RELAY_URL=https://keryx-relay.fly.dev
EXPO_PUBLIC_VAPID_PUBLIC=BOJ7j2UTkiGYAKjEs5SiMiKl7UdQAhcKogExGAvbdzX0HE5CX48NS9q9Yo_eOJEhaDfdVUoDf7_dne5ABqd5YYY
```

Without a relay URL, the native notification self-test reports that notifications
could not be registered even when the system permission is granted. iOS also
needs the Firebase and APNs setup described below.

The app then derives the same topic as the relay, registers the installation's
WebPush subscription, and the service worker verifies each wake-up against the
topic's exact scope before reconciling content. Local builds that should reach the
staging relay need `http://localhost:4173` in the relay's `RELAY_CORS_ORIGINS`.

### Notification states and the self-test

The relay is centralized, so the notification UI is **app-wide**, not
company-wide: one permission, one push subscription, one relay record holding the
union of every followed company's topics. The company settings sheet shows no
notification toggle; there is one top bar on the company list, shown only when
wake-ups need attention or while a test is in flight. A healthy install shows no
bar: the green "Notifications are working" is only the tail of the enable flow in
the same session.

After pairing and channel selection, the first company shows a dedicated **"Turn on
notifications"** screen (no skip — the tap is the user gesture the browser needs).
Granted → register, self-test, transient green, company view. Denied or dismissed →
the company view with the red bar and "Check again". A second company with
permission already granted and the registration current skips the screen and runs the
self-test silently.

| State | Detection | UI |
|---|---|---|
| Unsupported | no `Notification`/`PushManager`/SW, or `!isSecureContext` | neutral note; polling continues |
| Not asked | `permission === 'default'` | first-company screen, else red bar + "Turn on" (prompt needs the tap) |
| Blocked | `permission === 'denied'` | red bar + "Check again" + help URL |
| Granted, no subscription | `getSubscription() === null` | red bar + "Turn on" |
| Registered, relay says gone | heartbeat `404`/`401` | red bar + "Re-subscribe" |
| Registered, test failed | self-test per-leg result | red bar + the failing leg |
| Android, FCM topic set out of sync | native `getTopics` ≠ the followed union | red bar + "Re-subscribe" |
| Android, topic test not confirmed | topic-leg self-test result | neutral "sent — not confirmed yet" |
| Android, no transport | no Google services and no UnifiedPush distributor | red bar + "Install ntfy" |

After a denial no browser shows the prompt again, so "Check again" re-reads
the permission and subscription state instead of re-prompting; the wording is
generic ("allow notifications in your browser or system settings") plus one help
URL. The state is re-checked when the app returns to the foreground and after every sync, so the
bar clears itself once the user unblocks notifications.

"Check notifications" runs the relay's self-test (§5.3.1): one test delivery per
leg, reported per leg — browser wake-up delivered/not delivered (the PWA's service
worker or the UnifiedPush connector) and native wake-up sent/not sent (the FCM
handler; device receipt is unobservable). The in-flight state is never red: a green
"Notifications are working" appears on success and auto-dismisses into no bar — it is
the enable flow's tail, shown only in the session that ran it, never after a reload.
A slow topic leg shows neutral "sent — not confirmed yet" and upgrades to green if
it arrives later in the same session. Red appears only on a definitive failure, with
the failing leg and "Try again". It replaces a "no wake-up for N days" heuristic,
which would false-positive on companies that publish rarely.

See [`../design/notifications.md`](../design/notifications.md) for the rationale.

Browser `PushManager.subscribe` requires a real browser with a push service and
the notification permission (headless Chrome for Testing denies it), so that one
step is verified by the stubbed client test plus the service-worker test against
the relay's emitted fixture:

```sh
make relay relay-e2e        # relay end-to-end against ../keryx-demo
cd app && npm test          # app derivation + handlePush against the fixture
```

The full live path (a real browser push subscription and a real notification)
was also run with `relay/cmd/relay-harness`: it serves a resealed copy of
`../keryx-demo` over local HTTPS, exposes `/test/info` + `/test/publish`, and
the browser's service worker verified the relay's wake-up and showed the notice.
Build the app with `EXPO_PUBLIC_RELAY_URL` and `EXPO_PUBLIC_VAPID_PUBLIC` to repeat it.

## Architecture

```
src/lib/            protocol core (framework-free, unit-tested)
  bytes.ts          hex / base64url / sha256
  ed.ts             Ed25519 verification (noble)
  olpc.ts           OLPC canonical JSON (TUF metadata)
  pattern.ts        URL pattern (origin-exact, segment wildcard) + TUF path glob
  payload.ts        join URL / QR payload (no metadata URL; anchor derived)
  tuf.ts            TUF client: root chain, timestamp/snapshot/targets,
                    delegated channel roles, keyids, target pinning,
                    authorization model (channels + authors roles + patterns)
  item.ts           OLPC item verification (authors-role threshold or
                    channel-key), update/unpublish semantics, attachment hashes
  private.ts        private capability feed whole-document verification
  sync.ts           sync engine (metadata chain → channel roles → hash-pinned
                    items → private feeds → verify → store)
  pair.ts           pairing flow (TOFU + consent summary + subscribe)
  store.ts          companies, verified items, media + prefs over db.ts
  db.ts             key-value store: IndexedDB (web) / db.native.ts SQLite
  platform.ts       platform, debug flag, external links (+ .native.ts)
  native-push.ts    bridge to modules/keryx-push (+ .native.ts)
  richtext.ts       content_html → allowlisted render model
  media.ts          image loading with image/attachment/logo hash checks
  format.ts         date/domain helpers + local filtering (language + tags)
  scan.ts           web QR scan: BarcodeDetector or jsQR (the apps use
                    expo-camera, ui/QrScanner.tsx)
src/state.tsx       app state + sync orchestration
src/ui/             screens: AddCompany (input → confirm → consent), Contacts,
                    Company (full-article feed + settings sheet), RichText,
                    kit.tsx (UI primitives) + theme.ts (tokens)
src/lib/protocol.test.ts  tests against the real ../demo artifacts
src/lib/relay.ts       relay protocol: topic/scope derivation, wake-up parse +
                       Ed25519 threshold verification, registration client
src/lib/relay-sw.ts    service-worker wake-up handling: replay, recovery
                       cooldown, content reconciliation, topic bindings
src/lib/relay.test.ts  topic derivation + the relay-emitted wake-up fixture
src/lib/relay-sw.test.ts  handlePush against fake-indexeddb
src/sw.ts              custom service worker (workbox precache + push)
```

## Protocol tests

`npm run test` validates the client against the **actual** Go-signed demo
artifact: root anchor + repo_base discovery, full metadata chain and
per-channel role verification, all public + private item signatures
(authors-role threshold), whole-document private-feed verification (signature,
channel, url, version, closed), tamper rejection (modified item, wrong
channel key, missing author signatures, id/path mismatch), chain-break
detection (forged root rotations), rollback rejection (metadata + private-feed
version memory), keyid verification, pattern matching with segment
boundaries, join payload parsing (incl. newer-version refusal), and the
binary drop semantics (unpublished / no-longer-verifying items leave the
cache). This is the cross-check that the two implementations (Go publisher,
TS client) agree on the single canonicalization.

`KERYX_DEMO_DIR=<dir> npm test` runs the same suite against an artifact
generated by the publisher SDK showcase (`examples/sdk-artifact`), which is the direct check
that the app consumes SDK-generated content.

## Native

- `android/`, `ios/` are generated (`npx expo prebuild`) and never committed:
  configure them through `app.config.ts` and `plugins/with-keryx-android.js`
  (release signing from the CI keystore env vars, network security config).
- `modules/keryx-push` is the local Expo module behind every native wake-up:
  FCM topics (Android + iOS), the UnifiedPush connector (Android), the native
  §4 envelope gate against the mirror pushed by `verify-state.ts`, the payload
  queue, the relay ack and the generic notice — it works while the app is
  killed. The JS contract is `modules/keryx-push/src/KeryxPushModule.ts`.
- iOS wake-ups need `GoogleService-Info.plist` (the Firebase iOS app) in `app/`
  and an APNs-capable signing team; without the plist the app builds and runs
  with no wake-up transport (polling is the backstop).
- QR scanning: expo-camera with its on-device detector (no Google services
  needed); the web uses BarcodeDetector or jsQR.
- Build the APK: `make apk` (Android SDK); the iOS build needs macOS + Xcode
  (`npm run ios`).

## Design

Tokens derived from `../GRAPHICAL_DESIGN.md` (Substack-derived: electric blue
#0000ee accent, near-black #313131 text, system-ui stack, 8px spacing base,
pill controls), adapted for mobile per the product brief: body 16px, muted
text neutral gray, fast tap feedback, dark mode from the same palette. One
semantic red for destructive actions only. The app's own branding is
suppressed — the company identity (logo + name + join origin) carries the
screen; the feed shows full articles with big square preview images; the
single-company shortcut (no contacts list when only one source is added).

For a local Pages-layout check, build with `EXPO_BASE_URL=/keryx/ npm run build`,
then run `EXPO_BASE_URL=/keryx/ npm run preview` and open `/keryx/`.

The Swift envelope gate can also be checked against the same Go-signed fixture
as Java and TypeScript, without APNs credentials:

```sh
swiftc modules/keryx-push/ios/WakeupVerify.swift modules/keryx-push/tests/main.swift -o /tmp/keryx-swift-gate
/tmp/keryx-swift-gate src/lib/__fixtures__/relay-e2e.json
```

With the preview running, the repository-root `e2e-update.cjs` driver checks
first installation and two subsequent service-worker updates in the same Firefox
tab. Run it with Playwright on `NODE_PATH` and set `APP` to the preview URL
(including `/keryx/` when testing that base). It restores the generated `dist/sw.js`
after the check.
