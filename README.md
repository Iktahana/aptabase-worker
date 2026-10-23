# Aptabase Worker

A lightweight event receiver for Aptabase SDKs, built with TypeScript and Cloudflare Workers. Multiple applications share one Analytics Engine dataset, with stable app IDs and rotatable keys. Runtime dependencies: one Worker, one Analytics Engine dataset, and SQLite-backed Durable Objects for abuse protection. MIT licensed; deploy this repository, rather than publishing an npm package.

This project implements the **event ingestion protocol only**. It does not implement the Aptabase dashboard, authentication, query APIs, billing, Cron jobs, or archives. Cloudflare Workers metrics describe Worker operation; they do not automatically create Aptabase business charts.

## Step-by-step deployment

The basic setup deploys one production Worker. It can receive events for multiple apps. Add staging later if you need a separate test endpoint.

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

### 3. Connect and deploy

In **Workers & Pages → Create application → GitHub**, select your fork. Choose your Worker name and leave the Build, Deploy, and Preview commands unchanged. Workers Builds supplies the deployment name; the repository does not hardcode it. The base Wrangler configuration targets production, so the default `npx wrangler deploy` command uses the production dataset. Keep Preview builds enabled; preview branches use their own Analytics Engine dataset. Preview builds do not inherit production secrets; add `APPS` to **Previews Base** if you want preview URLs to accept events.

Select **Deploy**. The default `npm run build` runs formatting checks, dependency audit, type checks, tests, and a Wrangler dry-run before deployment. After the first build, open the Worker’s **Settings → Variables & Secrets**, add a secret named `APPS`, and paste the JSON from step 2. The endpoint will work once this secret is set.

### 4. Deploy and connect your SDK

Push to `main` and wait for the Cloudflare build to finish. Check `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/healthz` returns `{}`. Then send a test event using a key from `APPS`:

```sh
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/v0/event \
  -H 'Content-Type: application/json' \
  -H 'App-Key: A-SH-WEBSITE' \
  --data '{"timestamp":"2026-10-23T12:00:00Z","sessionId":"manual-check-1","eventName":"first_event","props":{"enabled":true}}'
```

The Worker should return `200 {}`. Set your SDK host to `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` and use the matching App-Key from `APPS`. See [SDK setup](#sdk-setup) for Web and Swift examples.

To add a staging Worker later, connect a second Worker with a name of your choice to a `staging` branch. For that Worker only, set the deploy command to `node scripts/deploy.mjs staging`, add the same `APPS` secret, and set the `WORKER_URL` build variable. It uses `wrangler.staging.jsonc` and writes to `aptabase_events_v1_staging`.

GitHub Actions runs tests on pull requests. Cloudflare Workers Builds handles validation and deployment on pushes to `main`.

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

## Abuse protection

Defaults match Aptabase’s ingestion rate and free monthly allowance:

| Variable                | Default | Scope                                                                             |
| ----------------------- | ------- | --------------------------------------------------------------------------------- |
| `RATE_LIMIT_PER_SECOND` | `20`    | Requests per IP per fixed one-second window, across apps and both event endpoints |
| `MONTHLY_EVENT_LIMIT`   | `20000` | Valid events per stable app ID per UTC calendar month                             |

Set either variable to `0` to disable that protection. Change the values in `wrangler.jsonc` (`vars` and `previews.vars`); use `wrangler.staging.jsonc` for staging. Invalid settings return 503.

Limits use Durable Objects, provisioned automatically on deployment. Preview counters are isolated from production. Missing client IPs share one rate bucket in local development. Rate rejection returns `429` with `Retry-After: 1`; exhausted quotas return `200 {"error":"monthly_quota_exceeded"}` to stop SDK retries. An exhausted app is rejected before its body is read. Batches exceeding the remaining quota are rejected as a whole. Only valid events reserve quota, before Analytics Engine submission; failed writes and duplicate retries can consume quota. Raising the limit resumes ingestion; month rollover resets it automatically. Unlike Aptabase’s account-wide allowance, this project gives each app its own allowance.

To pause an app, add `"disabled": true` to its entry in `APPS`. This blocks every key mapped to that app ID before reading the body. Remove the flag to resume. Missing and unknown keys are also rejected before body parsing. Public SDK keys cannot prove that events came from real users; limits reduce abuse rather than eliminate it.

## SDK setup

Web (`@aptabase/web`):

```ts
import * as Aptabase from "@aptabase/web";

Aptabase.init("A-SH-WEBSITE", {
  host: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
});
Aptabase.trackEvent("button_clicked", { button: "signup", enabled: true });
```

Swift (`Aptabase`):

```swift
import Aptabase

Aptabase.shared.initialize(appKey: "A-SH-IOS", with: InitOptions(
    host: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
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
