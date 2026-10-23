# Aptabase Worker

A lightweight event receiver for Aptabase SDKs, built with TypeScript and Cloudflare Workers. Multiple applications share one Analytics Engine dataset, with stable app IDs and rotatable keys. Runtime dependencies: one Worker and one Analytics Engine dataset. MIT licensed; deploy this repository, rather than publishing an npm package.

This project implements the **event ingestion protocol only**. It does not implement the Aptabase dashboard, authentication, query APIs, billing, Cron jobs, or archives. Cloudflare Workers metrics describe Worker operation; they do not automatically create Aptabase business charts.

## Deploy your fork

1. Fork this repository. Use Node.js 24 and run `npm ci`.
2. Enable Workers Analytics Engine in your Cloudflare account. Review [Analytics Engine setup](https://developers.cloudflare.com/analytics/analytics-engine/get-started/). Edit Worker names in `wrangler.jsonc` if needed. Development, staging, and production have separate dataset names. Datasets are created when first written; a healthy empty deployment may have no queryable rows yet.
3. In GitHub, create Environments named `staging` and `production`. Restrict deployments to `main`. Set these **environment secrets** in each:

   | Secret                  | Value                                                                                                                 |
   | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID                                                                                            |
   | `CLOUDFLARE_API_TOKEN`  | Account-scoped token with Workers Scripts Edit; add only permissions required by bindings or custom routes you enable |
   | `APPS`                  | JSON object mapping SDK keys to app configuration (below)                                                             |

   Set the environment **variable** `WORKER_URL` to the complete HTTPS Worker base URL, such as `https://aptabase-worker.YOUR-SUBDOMAIN.workers.dev`. Enable the account's workers.dev subdomain in Cloudflare first. For staging, use the staging Worker name. Add environment protection rules if desired; automatic production deployments must be permitted for fully automatic releases.
4. Enable GitHub Actions. Push to `main`: format, generated types, TypeScript, Workers tests, and dry-run builds must pass before production deploys. For staging, run **Check and release** manually on `main`, select `staging` and `deploy`. Every release checks `/healthz` afterward. Check failures and health failures fail the workflow; health failure does not trigger an automatic rollback.
5. Connect your SDK using an `A-SH-*` key and the custom host below. Complete [staging verification](docs/verification.md) before sending production traffic.

All production publishing and rollback run in GitHub Actions. No local npm login or Cloudflare login is required for development, checks, or dry runs. CI deploys the Worker and `APPS` secret together using Wrangler's `--secrets-file`; configuration is never committed or passed as command-line secret values. See [Cloudflare's CI instructions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/). Use a restricted API token today; this workflow does not assume direct GitHub OIDC support. If an officially supported federation flow becomes available and is adopted, verify it and revoke the bootstrap token. Rotate/revoke temporary tokens as soon as they are replaced.

## Applications and origins

Example `APPS` secret (replace the example SDK keys):

```json
{
  "A-SH-WEBSITE": { "id": "website" },
  "A-SH-WEBSITE2": { "id": "website" },
  "A-SH-IOS": { "id": "ios", "origins": ["https://example.com"] }
}
```

Keys are case insensitive. Multiple keys may map to the same stable ID for rotation; add the new key, release, migrate clients, then remove the old key in a later release. IDs must be nonblank and at most 96 UTF-8 bytes. Do not change an ID to rotate a key. Keys are client-visible routing identifiers, not authentication secrets.

Omitting `origins` permits any Origin (`Access-Control-Allow-Origin: *`). A configured list permits only exact HTTP(S) origins on POST; an empty list rejects all browser origins. Requests without Origin (including native SDKs) are allowed. CORS never enables credentials and cannot prevent non-browser abuse. Preflight is keyless and open for both event paths; the actual POST enforces the selected application's policy.

## SDK setup

Web (`@aptabase/web`):

```ts
import * as Aptabase from "@aptabase/web";

Aptabase.init("A-SH-WEBSITE", {
  host: "https://aptabase-worker.YOUR-SUBDOMAIN.workers.dev",
});
Aptabase.trackEvent("button_clicked", { button: "signup", enabled: true });
```

Swift (`Aptabase`):

```swift
import Aptabase

Aptabase.shared.initialize(appKey: "A-SH-IOS", with: InitOptions(
    host: "https://aptabase-worker.YOUR-SUBDOMAIN.workers.dev"
))
Aptabase.shared.trackEvent("app_started")
```

Use a base host without a trailing slash or API path. See [verified SDK sources and fixtures](docs/compatibility.md) for the precise compatibility scope. Other SDKs using the same event shapes may work but have not been verified here.

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Local bindings are simulated; no production resources are connected. Local Analytics Engine simulation does not prove remote persistence. Send a fixture:

```sh
curl http://localhost:8787/api/v0/event \
  -H 'Content-Type: application/json' -H 'App-Key: A-SH-LOCAL' \
  --data-binary @test/fixtures/web.json
```

`npm run check` runs all local checks, including the deployment dry run. `npm run types` regenerates the committed Wrangler types. `npm run format` applies Biome formatting and safe fixes. No runtime web framework is used.

## Operation and limitations

Successful ingestion returns `200 {}` when valid data points have been submitted to the binding. Analytics Engine writes are non-blocking and provide no persistence acknowledgment; see [Cloudflare's write example](https://developers.cloudflare.com/workers/examples/analytics-engine/). A synchronous binding error returns 503; a partial batch write can cause duplicates if clients retry. There is no deduplication or durable queue.

Analytics Engine samples data and retains it for **three months**, per its [limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/). Sampling is grouped by stable app ID. Use sampling-aware SQL for aggregates. Do not treat this service as a lossless event archive. See [protocol and data layout](docs/protocol.md), [privacy](docs/privacy.md), and [release verification and rollback](docs/verification.md).

Request logs contain only aggregate event counts and fixed reason codes. Workers Observability is enabled at a 10% head sampling rate. Cloudflare may collect platform request metadata independently; configure platform access and retention appropriately. Health checks validate configuration and binding presence without writing an event or proving storage availability.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reporting: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).
