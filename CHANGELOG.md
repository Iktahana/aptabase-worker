# Changelog

## Unreleased

- Add configurable IP request limits, monthly per-app quotas, and app disabling with Durable Object counters.
- Let Workers Builds supply the Worker name so forks can choose their own name.

- Move Worker deployment from GitHub Actions to Cloudflare Workers Builds. GitHub Actions now runs tests only; Cloudflare manages deployment credentials internally.
- Configure `APPS` as a runtime secret in each Cloudflare Worker.

## 1.0.0 — Unreleased

- Add single and batch Aptabase event ingestion, multi-app key routing, key rotation, origin policies, bounded streaming reads, and health checks.
- Add versioned Analytics Engine encoding with UTF-8 size validation and structured aggregate logs.
- Add local development, Workers runtime tests, CI checks, CI deployment and manual rollback, and deployment documentation.
