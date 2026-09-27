# iOS simulator QA

Tested on 2026-09-27 with an isolated iPhone 17 Pro simulator running iOS 26.5.
The app was built from this branch, installed as `cz.v1b3coder.keryx`, and tested
through its native UI. Other running simulators were left alone. Notifications
were excluded at the user's request.

An isolated HTTPS publisher, signed with the SDK's `pub` CLI, supplied controlled
updates, media and failure cases. Its temporary keys stayed outside the checkout.
The public demo was used read-only to check a second company and a private order
feed. Outages were simulated by stopping only the isolated publisher.

| Check | Result |
| --- | --- |
| Debug simulator build, install and cold launch | Passed |
| Invalid pasted link; origin confirmation before fetching | Passed |
| Pairing, channel selection, continuation without push | Passed |
| Signed public articles and private order feed | Passed |
| Language/tag filters, empty state, channel unsubscribe/resubscribe | Passed |
| Exact date toggle, scrolling, two-company navigation | Passed |
| New content on cold launch and return from iOS home screen | Passed after fix |
| Image preference survives restart and prevents new image requests | Passed after fix |
| External link confirmation, cancel, native browser and return | Passed |
| Valid attachment opens; altered attachment is rejected | Passed |
| Cached articles after publisher outage, restart and manual refresh | Passed |
| Restored publisher clears error and supplies new content | Passed |
| Altered item rejected and previous cached copy removed | Passed after fix |
| Valid item restored after rejection | Passed |
| Company removal cancelled, then confirmed; remaining company retained | Passed |
| Camera permission request, denial, return to paste-link fallback | Passed after installing compatible scanner |
| Light/dark appearance, portrait/landscape layout | Passed visual checks |

The checked-in `e2e-content.cjs` repeats the content regressions with real signed
fixtures in WebKit. It also checks that scripts/forms are removed, inline images
remain usable, remote images are fetched for verification before rendering, bad
media hashes prevent display, and rejected cached content stays deleted after an
offline reload. It also rejects oversized replacements and delays responses to
prove background sync cannot overwrite a privacy change or restore a removed
company. `e2e-no-push.cjs` covers the unsupported-notification setup flow.

The simulator does not prove optical QR recognition. Test scan success and camera
presentation/cancellation on a physical iPhone before release. Device signing,
App Store distribution, exhaustive accessibility coverage, Android phone E2E and
production deployments were not exercised by this simulator QA run. Notification
integration and device delivery remain deferred in the [setup checklist](../README.md#ios-notification-setup-todo).
