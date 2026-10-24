# Changelog

## Unreleased

- Normalize Cloudflare country and region fields, store the region code in `blob18`, and rate-limit IPv6 by `/64`. Reject missing or unparseable client IPs when the IP limit is enabled.

- Pin `undici` 7.30.1 and `zod` 4.6.7 so the release audit passes.

- Serve robots.txt and noindex response headers; document SDK endpoint allowlists and optional WAF restrictions.

- Pin event response compatibility to Aptabase 4cca4bb: lock/key messages, text validation errors, safe problem JSON, empty 429 responses, and quota prechecks before media validation. Preserve data rules and document SDK retry behavior.

- Preserve dashboard runtime variables during deployment and supply optional limits from code defaults.

- Add configurable IP request limits, monthly per-app quotas, and app disabling with Durable Object counters.
- Let Workers Builds supply the Worker name so forks can choose their own name.

- Move Worker deployment from GitHub Actions to Cloudflare Workers Builds. GitHub Actions now runs tests only; Cloudflare manages deployment credentials internally.
- Configure `APPS` as a runtime secret in each Cloudflare Worker.

## 1.0.0 — Unreleased

- Add single and batch Aptabase event ingestion, multi-app key routing, key rotation, origin policies, bounded streaming reads, and health checks.
- Add versioned Analytics Engine encoding with UTF-8 size validation and structured aggregate logs.
- Add local development, Workers runtime tests, CI checks, CI deployment and manual rollback, and deployment documentation.
