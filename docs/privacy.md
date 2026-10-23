# Privacy and reliability

The Worker stores SDK session IDs, event names, supplied system and custom properties, and country/region supplied by Cloudflare. Session IDs remain opaque strings. It does not store raw IP addresses or User-Agent headers, parse browser User-Agent strings, generate fingerprints, or infer missing OS information. Clients must avoid personal data in arbitrary properties, event names, and extra system fields; these are retained as supplied.

Keys are public SDK routing identifiers. CORS controls browsers and is not an authentication or abuse-prevention mechanism. Operators may apply Cloudflare protections to suit their workloads.

Application logs contain received/submitted/dropped event counts and fixed reason codes, never payloads, keys, exception messages, or request headers. Platform logs and account request metadata are managed by Cloudflare and need separate operational review. Observability head sampling is configured at 0.1.

Analytics Engine writes are non-blocking and do not acknowledge durable storage. A 200 response means submission, not confirmed persistence. Sampling and platform retention apply. Network and server failures can lead SDKs to retry and create duplicate events, including already submitted entries from a partially failed batch. There is no deduplication, durable buffering, long-term archival, or exactly-once guarantee.
