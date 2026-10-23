# Aptabase Worker

A lightweight event receiver for Aptabase SDKs, built with TypeScript and Cloudflare Workers. Multiple applications share one Analytics Engine dataset, with stable app IDs and rotatable keys. Runtime dependencies: one Worker and one Analytics Engine dataset. MIT licensed; deploy this repository, rather than publishing an npm package.

This project implements the **event ingestion protocol only**. It does not implement the Aptabase dashboard, authentication, query APIs, billing, Cron jobs, or archives. Cloudflare Workers metrics describe Worker operation; they do not automatically create Aptabase business charts.

## Step-by-step deployment

This guide creates separate staging and production Workers, each with its own Analytics Engine dataset. One Worker can receive events for multiple apps.

### 1. Fork the repository and prepare Cloudflare

Fork this repository in GitHub and keep the default branch named `main`. In Cloudflare, enable a `workers.dev` subdomain and connect your GitHub account to [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).

### 2. Define your apps

Create an `APPS` JSON mapping. Each key is the App-Key used by an SDK; each `id` is the stable app label stored in Analytics Engine. For example:

```json
{
  "A-SH-WEBSITE": { "id": "website" },
  "A-SH-IOS": { "id": "ios" }
}
```

Use a different ID for each app you want to report separately. You can map multiple keys to one ID to rotate keys later.

### 3. Create the staging and production Workers

Create a `staging` branch in your fork. In Cloudflare, create two Workers Builds projects connected to the fork. Set their build options as follows; replace `YOUR-SUBDOMAIN` with your `workers.dev` subdomain.

| Setting                     | Staging                                                      | Production                                           |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Git repository              | Your fork                                                    | Your fork                                            |
| Production branch           | `staging`                                                    | `main`                                               |
| Build command               | `npm run check`                                              | `npm run check`                                      |
| Deploy command              | `node scripts/deploy.mjs staging`                            | `node scripts/deploy.mjs production`                 |
| Build variable `WORKER_URL` | `https://aptabase-worker-staging.YOUR-SUBDOMAIN.workers.dev` | `https://aptabase-worker.YOUR-SUBDOMAIN.workers.dev` |
| Worker name / dataset       | `aptabase-worker-staging` / `aptabase_events_v1_staging`     | `aptabase-worker` / `aptabase_events_v1`             |

For each Worker, open **Settings → Variables & Secrets** and add `APPS` with the JSON from step 2. Cloudflare creates the Analytics Engine datasets on first write. Workers Builds runs `npm run check`, deploys the Worker, then checks `/healthz`.

### 4. Deploy and test staging

Push a change to `staging` and wait for the Cloudflare build to finish. Send a test event to the staging URL using a key from `APPS`:

```sh
curl https://aptabase-worker-staging.YOUR-SUBDOMAIN.workers.dev/api/v0/event \
  -H 'Content-Type: application/json' \
  -H 'App-Key: A-SH-WEBSITE' \
  --data '{"timestamp":"2026-10-23T12:00:00Z","sessionId":"manual-check-1","eventName":"staging_check","systemProps":{"isDebug":true},"props":{"enabled":true}}'
```

The Worker should return `200 {}`. The health endpoint is `https://aptabase-worker-staging.YOUR-SUBDOMAIN.workers.dev/healthz`. For a full SDK and data check, follow [staging verification](docs/verification.md).

### 5. Deploy production and connect your SDK

After staging works, merge `staging` into `main`. Cloudflare Builds deploys production. Set your SDK host to `https://aptabase-worker.YOUR-SUBDOMAIN.workers.dev` and use the corresponding App-Key from `APPS`. See [SDK setup](#sdk-setup) for Web and Swift examples.

GitHub Actions runs tests on pull requests. Cloudflare Workers Builds handles validation and deployment for pushes to the configured branches.

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
