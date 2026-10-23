# Ingestion protocol and schema v1

## HTTP

- `POST /api/v0/event`: one object; invalid events return 400.
- `POST /api/v0/events`: an array of at most 25 entries; invalid entries are skipped, valid entries are written. Empty and entirely invalid batches return `200 {}` with no writes.
- Both paths accept `OPTIONS` without an App-Key and return 204.
- `GET /healthz`: `200 {}` when app configuration, body limit, and binding shape are valid; otherwise 503. It never writes.

POST requires `Content-Type: application/json` (parameters such as charset are accepted). App lookup precedes body consumption. Missing or unknown keys return HTTP 200 with a fixed English `error` message ending in `Events are not being recorded.` Unknown keys are never reflected. This follows upstream's non-retry status convention. Keys are case insensitive.

Malformed JSON, invalid UTF-8, and invalid body shapes return 400; unsupported content types return 415; excessive request bodies return 413; disallowed Origins return 403; configuration or synchronous binding failures return 503. Unknown routes return 404 and unsupported methods return 405. Errors use `{ "error": "fixed_code_or_message" }`. Body reads count actual streamed bytes regardless of Content-Length. `MAX_BODY_BYTES` defaults to 524288 (512 KiB); it can be reduced to any positive integer, up to that hard ceiling, in every Wrangler environment.

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

| Column    | Value                                     |
| --------- | ----------------------------------------- |
| index1    | Stable app ID; sampling group             |
| blob1     | Schema version, string `1`                |
| blob2     | Stable app ID                             |
| blob3     | Event name                                |
| blob4     | Opaque session ID                         |
| blob5     | Locale                                    |
| blob6     | OS name                                   |
| blob7     | OS version                                |
| blob8     | Device model                              |
| blob9     | App version                               |
| blob10    | App build number                          |
| blob11    | SDK version                               |
| blob12    | Engine name                               |
| blob13    | Engine version                            |
| blob14    | Country from trusted `request.cf.country` |
| blob15    | Region from trusted `request.cf.region`   |
| blob16    | Custom properties JSON                    |
| blob17    | Extra system properties JSON              |
| double1   | Client event time, Unix milliseconds      |
| double2   | Debug flag, 0 or 1                        |
| timestamp | Analytics Engine reception time           |

Client and reception timestamps serve different purposes; select the appropriate one explicitly in future aggregations. Schema evolution only appends fields without changing existing meanings. Incompatible changes require a new dataset.

Future daily archives should use UTC date partitions, repeatable jobs, and processing checkpoints. Recovering complete raw events from sampled AE results is impossible; full raw archives require an additional durable ingestion path. No archival or query endpoint is included in v1.
