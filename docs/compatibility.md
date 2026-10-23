# Verified compatibility scope

Fixtures model the serialized requests in these pinned official sources. They are synthetic examples derived from source, not captured user data. SDK version strings ending in `@fixture` are test labels, not release numbers.

| Client                  | Source revision                                                                                                                                                       | Endpoint         | Coverage                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Web / shared JavaScript | [`shared.ts` at 7206aed](https://github.com/aptabase/aptabase-js/blob/7206aed16c8620f0cd63c4797d4543e7d8932f09/packages/shared.ts)                                    | `/api/v0/event`  | UTC milliseconds, opaque numeric-looking session string, boolean props, browser defaults, custom `host` for `A-SH-*` |
| Swift                   | [`EventDispatcher.swift` at 4c66f5f](https://github.com/aptabase/aptabase-swift/blob/4c66f5f21b6a4a0667a2d3541df9c77a4d7f99f3/Sources/Aptabase/EventDispatcher.swift) | `/api/v0/events` | Up to 25 events, UTC whole seconds, native system properties, absent props                                           |

The README's Swift setup uses the instance API in [Aptabase.swift](https://github.com/aptabase/aptabase-swift/blob/4c66f5f21b6a4a0667a2d3541df9c77a4d7f99f3/Sources/Aptabase/Aptabase.swift) and [InitOptions.swift](https://github.com/aptabase/aptabase-swift/blob/4c66f5f21b6a4a0667a2d3541df9c77a4d7f99f3/Sources/Aptabase/InitOptions.swift).

[`ResolveAppKeyAttribute.cs` at 4cca4bb](https://github.com/aptabase/aptabase/blob/4cca4bb394819c3591c019f758ce09c2844e544e/src/Features/Ingestion/ResolveAppKeyAttribute.cs) establishes the HTTP 200 convention for rejected keys. This receiver uses a fixed unknown-key message to avoid reflecting identifiers.

Local automated tests verify wire-format acceptance and point encoding. They do not execute either SDK or establish end-to-end remote delivery. Before release, record real Web and Swift staging results using [verification.md](verification.md). Compatibility with other SDKs or other Aptabase product APIs is not asserted.
