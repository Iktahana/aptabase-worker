# Aptabase Worker

A lightweight event receiver for Aptabase SDKs, built with TypeScript and Cloudflare Workers. Multiple applications share one Analytics Engine dataset, with stable app IDs and rotatable keys. Runtime dependencies: one Worker and one Analytics Engine dataset. MIT licensed; deploy this repository, rather than publishing an npm package.

This project implements the **event ingestion protocol only**. It does not implement the Aptabase dashboard, authentication, query APIs, billing, Cron jobs, or archives. Cloudflare Workers metrics describe Worker operation; they do not automatically create Aptabase business charts.

## Step-by-step deployment

You will deploy one Worker that can receive events for several apps. Development, staging, and production use separate Analytics Engine datasets. The staging and production Worker names in `wrangler.jsonc` are `aptabase-worker-staging` and `aptabase-worker`; change them before deploying if those names are already taken in your Cloudflare account.

### 1. Fork the repository

Select **Fork** in GitHub and create a fork under your account or organization. Keep the default branch named `main`. Use Node.js 24.22.1 or a later Node 24 security patch for local commands. No npm account or npm publishing access is needed. The fork is a deployable repository, not an npm package.

### 2. Prepare Cloudflare

1. Sign in to Cloudflare and enable the Workers `workers.dev` subdomain for your account if you have not already.
2. Make sure Workers Analytics Engine is available in the account. You do not need to create datasets by hand: Wrangler configures the bindings, and Cloudflare creates each dataset on its first write. See [Cloudflare's Analytics Engine setup](https://developers.cloudflare.com/analytics/analytics-engine/get-started/).
3. Connect the GitHub repository using [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). Cloudflare manages its deployment credential internally; you do not need to create, copy, or maintain a Cloudflare API token. The first GitHub connection requires authorizing Cloudflare's GitHub app.

### 3. Choose app keys and IDs

Create an `APPS` JSON value. Each key is an App-Key that you will put in an SDK; each `id` is a stable label used to distinguish apps in Analytics Engine. You can use an Aptabase-shaped self-hosted key such as `A-SH-WEBSITE`:

```json
{
  "A-SH-WEBSITE": { "id": "website" },
  "A-SH-IOS": { "id": "ios" }
}
```

Use a separate key and ID for each app whose analytics you want to keep separate. To rotate a key, add the new key with the same ID, deploy, update the client, then remove the old key in a later deployment. Keys are visible in client apps, so treat them as routing identifiers, not passwords. See [Applications and origins](#applications-and-origins) for optional browser Origin restrictions.

### 4. Configure staging and production in Cloudflare

Create a `staging` branch in the fork. In Cloudflare, connect the repository to two Workers Builds projects, one for staging and one for production. Use these settings in each project's **Settings → Builds**. Replace `YOUR-SUBDOMAIN` with your Cloudflare `workers.dev` subdomain:

| Setting                     | Staging                                                      | Production                                           |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Git repository              | Your fork                                                    | Your fork                                            |
| Production branch           | `staging`                                                    | `main`                                               |
| Build command               | `npm run check`                                              | `npm run check`                                      |
| Deploy command              | `node scripts/deploy.mjs staging`                            | `node scripts/deploy.mjs production`                 |
| Build variable `WORKER_URL` | `https://aptabase-worker-staging.YOUR-SUBDOMAIN.workers.dev` | `https://aptabase-worker.YOUR-SUBDOMAIN.workers.dev` |
| Worker name / dataset       | `aptabase-worker-staging` / `aptabase_events_v1_staging`     | `aptabase-worker` / `aptabase_events_v1`             |

The `check` command runs formatting, dependency security audit, type generation check, TypeScript, tests, and a Wrangler dry run. Cloudflare then runs the deploy command and checks `/healthz`. Cloudflare Workers Builds automatically creates and manages its own deployment API token; do not add a Cloudflare token to GitHub secrets. For each Worker, add the `APPS` runtime secret once under **Settings → Variables & Secrets**. Set the same mapping in both environments unless you intentionally want different accepted keys.

### 5. Deploy and verify staging

1. Push or merge the code to the `staging` branch. GitHub Actions runs the tests, and Cloudflare Workers Builds runs the build and staging deployment. Require the `Checks / check` status on pull requests into `staging` in GitHub branch protection.
2. Wait for the Cloudflare build to deploy and pass its health check. The endpoint should return `{}` at `https://aptabase-worker-staging.YOUR-SUBDOMAIN.workers.dev/healthz`. Health confirms that the Worker can read its configuration and binding; it does not write a test event or prove Analytics Engine persistence.
3. Send a sample event using the same host and one key in `APPS`:

   ```sh
   curl https://aptabase-worker-staging.YOUR-SUBDOMAIN.workers.dev/api/v0/event \
     -H 'Content-Type: application/json' \
     -H 'App-Key: A-SH-WEBSITE' \
     --data '{"timestamp":"2026-10-23T12:00:00Z","sessionId":"manual-check-1","eventName":"staging_check","systemProps":{"isDebug":true},"props":{"enabled":true}}'
   ```

   A valid event returns `200 {}`. Follow [staging verification](docs/verification.md) to test real Web and Swift SDKs and confirm the stored column mapping before directing production clients to the Worker.

### 6. Deploy production

After staging verification, merge the reviewed `staging` branch into `main`. GitHub Actions runs the tests and Cloudflare Workers Builds builds and deploys production, then checks `/healthz`. If a health check fails, the Cloudflare build reports failure; it does not automatically roll back. Use Cloudflare's deployment history to roll back if needed.

Every pull request runs tests but does not deploy. Protect `main` with the passing GitHub Actions check before merging.

### 7. Connect your SDK

Use the production base URL and the matching key from `APPS`. For setup examples, see [SDK setup](#sdk-setup). The host should contain only the scheme and hostname: do not add `/api/v0/event`, and do not add a trailing slash.

Production publishing is handled by Cloudflare Workers Builds, while GitHub Actions only runs tests. The `APPS` value is a Worker runtime secret set in the Cloudflare dashboard; it is never committed or passed as a command-line value. Cloudflare manages the credential it uses to deploy, so no user-created API token is needed. The deployment script requires Cloudflare's Workers Builds environment marker.

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
