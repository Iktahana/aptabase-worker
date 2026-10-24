# Ingestion protocol and schema v1

## HTTP

All Worker responses include `X-Robots-Tag: noindex`. `GET /robots.txt` returns `User-agent: *` and `Disallow: /`; HEAD returns the same headers with no body. Robots responses require no app configuration or bindings and do not access counters or analytics. These are voluntary crawler/indexing directives, not access control. See [WAF guidance](waf.md) for endpoint restrictions.
- `POST /api/v0/event`: one object; invalid events return 400.
- `POST /api/v0/events`: an array of at most 25 entries; invalid entries are skipped, valid entries are written. Empty and entirely invalid batches return `200 {}` with no writes.
- Both paths accept `OPTIONS` without an App-Key and return 204.
- `GET /healthz`: `200 {}` when app configuration, body/protection limits, and binding shapes are valid; otherwise 503. It never writes.

Compatibility is pinned to Aptabase receiver commit [`4cca4bb394819c3591c019f758ce09c2844e544e`](https://github.com/aptabase/aptabase/tree/4cca4bb394819c3591c019f758ce09c2844e544e/src/Features/Ingestion). This is event-interface compatibility with the data and security differences below, not a replacement for the full Aptabase product.

| Scenario                                           | Status | Content-Type              | Body                                                                                   |
| -------------------------------------------------- | ------ | ------------------------- | -------------------------------------------------------------------------------------- |
| Single/batch success, empty/all-invalid batch      | 200    | application/json          | `{}`                                                                                   |
| Missing key                                        | 200    | application/json          | `{"error":"Missing App-Key header. Events are not being recorded."}`                   |
| Unknown key                                        | 200    | application/json          | `{"error":"Application not found with given app key. Events are not being recorded."}` |
| Disabled app or exhausted app quota                | 200    | application/json          | `{"error":"Owner account is locked. Events are not being recorded."}`                  |
| Invalid single event, including oversized AE point | 400    | text/plain; charset=utf-8 | `Invalid event.`                                                                       |
| More than 25 batch entries                         | 400    | text/plain; charset=utf-8 | `Too many events (N) in a single request. Maximum is 25.`                              |
| Malformed JSON / invalid UTF-8                     | 400    | application/problem+json  | `{"type":"about:blank","title":"Invalid JSON body.","status":400}`                     |
| Wrong endpoint body shape                          | 400    | application/problem+json  | Same problem shape, title `Invalid request body shape.`                                |
| Unsupported Content-Type                           | 415    | application/problem+json  | Same problem shape, title `Content-Type must be application/json.`, status 415         |
| IP rate limit                                      | 429    | absent                    | Empty body; `Retry-After: 1` extension                                                 |
| Request too large                                  | 413    | application/json          | `{"error":"body_too_large"}`                                                           |
| Origin denied                                      | 403    | application/json          | `{"error":"origin_denied"}`                                                            |
| Invalid APPS                                       | 503    | application/json          | Fixed setup instructions linking to README                                             |
| Configuration/counter failure                      | 503    | application/json          | `{"error":"service_unavailable"}`                                                      |
| AE submission failure                              | 503    | application/json          | `{"error":"write_failed"}`                                                             |

All responses carry `Cache-Control: no-store`. POST requires `Content-Type: application/json` (parameters such as charset are accepted). Keys are case insensitive. Processing order is configuration, IP limit, app lookup/disabled check, Origin policy, quota precheck, media/body validation, atomic quota reservation, write. Missing, unknown, disabled and already exhausted apps never consume the body. Unknown keys, payloads and exception messages are never reflected in responses or application logs. Unknown routes return 404 and unsupported methods return 405 with fixed error JSON.

Body reads count actual streamed bytes regardless of Content-Length. `MAX_BODY_BYTES` defaults to 524288 (512 KiB); it can be reduced to any positive integer, up to that hard ceiling, in every Wrangler environment.

The unknown-key text omits the upstream key interpolation. Single-event validation uses a fixed generic English message rather than upstream field-specific messages. Problem responses deliberately omit framework traces and submitted values. The lock message is upstream wording: this project's lock and monthly quota apply to an app ID, not an owner account. CORS remains open by default with configured Origin restrictions; OPTIONS returns 204. Platform limits and the Retry-After header are retained extensions.

## Event shape

Required fields:

| Field       | Rule                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| `timestamp` | Valid UTC ISO date/time `YYYY-MM-DDTHH:mm:ss[.SSS]Z`, with 1–3 optional fractional digits |
| `eventName` | Nonblank string, preserved without trimming                                               |
| `sessionId` | Opaque string; never converted to a number                                                |

`props` may be absent or null, normalized to `{}`; otherwise an object whose values are strings, finite numbers, or booleans. Arrays, nested objects, and null property values are invalid. `systemProps` may be absent or null. Known textual fields must be strings when present; `isDebug` must be boolean when present and defaults to false. Missing textual fields become empty strings. Extra system fields are preserved as JSON, including nested values. Unknown top-level fields are accepted and ignored. JSON objects follow standard JSON parsing semantics, including the last duplicate property winning.

One event becomes one data point. The combined UTF-8 size of all encoded blobs must be at most 16384 bytes. Oversized events are invalid and never truncated. App IDs also satisfy the separate 96-byte index limit. At most 25 points are submitted per request.

## Frozen Analytics Engine columns

Production dataset: `aptabase_events_v1`. Staging: `aptabase_events_v1_staging`. Worker Previews: `aptabase_events_v1_preview`. Local development uses the same dataset name as the base configuration, but Wrangler simulates the binding locally and does not write to the remote dataset.

| Column    | Value                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------- |
| index1    | Stable app ID; sampling group                                                                      |
| blob1     | Schema version, string `1`                                                                         |
| blob2     | Stable app ID                                                                                      |
| blob3     | Event name                                                                                         |
| blob4     | Opaque session ID                                                                                  |
| blob5     | Locale                                                                                             |
| blob6     | OS name                                                                                            |
| blob7     | OS version                                                                                         |
| blob8     | Device model                                                                                       |
| blob9     | App version                                                                                        |
| blob10    | App build number                                                                                   |
| blob11    | SDK version                                                                                        |
| blob12    | Engine name                                                                                        |
| blob13    | Engine version                                                                                     |
| blob14    | Normalized country: uppercase `request.cf.country` when it is `T1` or two letters, otherwise empty |
| blob15    | Trimmed `request.cf.region`, kept only when its UTF-8 size is at most 64 bytes                     |
| blob16    | Custom properties JSON                                                                             |
| blob17    | Extra system properties JSON                                                                       |
| blob18    | Normalized `request.cf.regionCode`: uppercase, one to three letters or digits, otherwise empty     |
| double1   | Client event time, Unix milliseconds                                                               |
| double2   | Debug flag, 0 or 1                                                                                 |
| timestamp | Analytics Engine reception time                                                                    |

Client and reception timestamps serve different purposes; select the appropriate one explicitly in future aggregations. Schema evolution only appends fields without changing existing meanings. Incompatible changes require a new dataset.

`blob14` keeps Cloudflare's `XX` and uses `T1` for Tor. Empty `blob14`, `blob15`, or `blob18` means the value was missing or rejected. Rows written before region codes were stored also have an empty `blob18`. These columns estimate the egress IP's location. Do not fill gaps from `blob5`, which is the client locale. Aggregate counts with `sum(_sample_interval)`. Group countries by `blob14`, leaving `T1` and empty values separate. Group regions by `blob14` and `blob18`, using `blob15` only as a label, and show regions inside one country. City, postal code, and coordinates are not stored.

Future daily archives should use UTC date partitions, repeatable jobs, and processing checkpoints. Recovering complete raw events from sampled AE results is impossible; full raw archives require an additional durable ingestion path. No archival or query endpoint is included in v1.

## Abuse protection

See [configuration and response behavior](../README.md#abuse-protection). Rate limits run before key lookup, so unknown keys also consume the IP request budget. Disabled apps and exhausted app quotas are rejected before body consumption. A second atomic quota reservation after validation prevents concurrent batches from exceeding the limit. Storage failures fail closed with 503; health checks validate binding shapes without writing counters. Quota reservations are conservative and are not rolled back after failed writes.
