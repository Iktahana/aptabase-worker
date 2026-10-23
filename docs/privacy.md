# Privacy and reliability

The Worker stores SDK session IDs, event names, supplied system and custom properties, and country/region supplied by Cloudflare. Session IDs remain opaque strings. It does not store raw IP addresses or User-Agent headers, parse browser User-Agent strings, generate fingerprints, or infer missing OS information. Clients must avoid personal data in arbitrary properties, event names, and extra system fields; these are retained as supplied.

Keys are public SDK routing identifiers. CORS controls browsers and is not an authentication or abuse-prevention mechanism. Built-in IP request limits and per-app monthly event quotas reduce abuse; they cannot authenticate events. Cloudflare protections can supplement them.

Application logs contain received/submitted/dropped event counts and fixed reason codes, never payloads, keys, exception messages, or request headers. Platform logs and account request metadata are managed by Cloudflare and need separate operational review. Observability head sampling is configured at 0.1.

Analytics Engine writes are non-blocking and do not acknowledge durable storage. A 200 response means submission, not confirmed persistence. Sampling and platform retention apply. Network and server failures can lead SDKs to retry and create duplicate events, including already submitted entries from a partially failed batch. There is no deduplication, durable buffering, long-term archival, or exactly-once guarantee.

Rate limiting reads Cloudflare’s `CF-Connecting-IP` header transiently. Object names use a SHA-256 digest of the UTC date and IP; raw IPs are never persisted or logged. These digests are pseudonymous, not guaranteed anonymous. Idle rate counters are deleted by an alarm scheduled 60 seconds after the latest request (alarm execution may be delayed). Monthly counters retain only the current month and reserved count per stable app ID. Counters are separate from analytics and are never used for visitor metrics.
