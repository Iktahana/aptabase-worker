# Aptabase Worker

Receive events from Aptabase SDKs on Cloudflare Workers and store them in Analytics Engine. Supports multiple apps, key rotation, and configurable abuse protection. MIT licensed.

## Quickstart

You need a GitHub account and a Cloudflare account.

### 1. Fork and deploy

[Fork this repository](https://github.com/Iktahana/aptabase-worker/fork). In Cloudflare, open **Workers & Pages**, choose **Create application**, and connect your fork from GitHub.

Choose a Worker name, keep all other settings at their defaults, and click **Deploy**. If prompted, set up your `workers.dev` subdomain. Wait for deployment to finish and copy your Worker URL.

### 2. Define your apps

Open your Worker’s **Settings → Runtime variables and secrets**. Keep **Production** selected and click **Add variable**. In the **Add environment variable** dialog, keep **Production** selected, enter `APPS` under **Key**, and paste this JSON under **Value**:

```json
{
  "A-SH-MYAPP": { "id": "my-app" }
}
```

Click **Add variable and deploy**. This creates your first app: `A-SH-MYAPP` is the key your SDK sends; `my-app` is its label in stored events. Choose your own values and use the same key in the next step.

Open `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/healthz`. A response of `{}` means setup is complete.

### 3. Send your first event

For a web app, install the SDK:

```sh
npm install @aptabase/web
```

Initialize it with your app key and Worker URL:

```ts
import * as Aptabase from "@aptabase/web";

Aptabase.init("A-SH-MYAPP", {
  host: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
});
Aptabase.trackEvent("app_started");
```

Use your Worker’s base URL as `host`, without a trailing slash or `/api` path. For iOS and macOS, see [Swift setup](#sdk-setup).

Future pushes to `main` deploy automatically through Cloudflare Workers Builds.

## Configuration

The defaults allow **20 requests per IP per second** and **20,000 events per app per month**. The following settings are optional.

Manage runtime settings in the Cloudflare dashboard. `keep_vars: true` preserves them across CI deployments; Wrangler manages resource bindings and migrations. `APPS` may be a regular variable or a Secret. Existing secrets continue to work. Runtime settings are independent of Git rollbacks.

### Apps, keys, and origins

Example `APPS` variable (replace the example SDK keys):

```json
{
  "A-SH-WEBSITE": { "id": "website" },
  "A-SH-WEBSITE2": { "id": "website" },
  "A-SH-IOS": { "id": "ios", "origins": ["https://example.com"] }
}
```

Keys are case insensitive. Multiple keys may map to the same stable ID for rotation; add the new key, release, migrate clients, then remove the old key in a later release. IDs must be nonblank and at most 96 UTF-8 bytes. Do not change an ID to rotate a key. Keys are client-visible routing identifiers, not authentication secrets.

Omitting `origins` permits any Origin (`Access-Control-Allow-Origin: *`). A configured list permits only exact HTTP(S) origins on POST; an empty list rejects all browser origins. Requests without Origin (including native SDKs) are allowed. CORS never enables credentials and cannot prevent non-browser abuse. Preflight is keyless and open for both event paths; the actual POST enforces the selected application's policy.

### Abuse protection

Defaults match Aptabase’s ingestion rate and free monthly allowance:

| Variable                | Default | Scope                                                                             |
| ----------------------- | ------- | --------------------------------------------------------------------------------- |
| `RATE_LIMIT_PER_SECOND` | `20`    | Requests per IP per fixed one-second window, across apps and both event endpoints |
| `MONTHLY_EVENT_LIMIT`   | `20000` | Valid events per stable app ID per UTC calendar month                             |

To change a limit, add or edit its variable in **Settings → Runtime variables and secrets → Production**. Set it to `0` to disable that protection. Omitted values use the defaults above. `MAX_BODY_BYTES` optionally lowers the body limit from `524288` bytes (512 KiB). Invalid settings return 503.

Limits use Durable Objects, provisioned automatically on deployment. Preview counters are isolated from production. Missing client IPs share one rate bucket in local development. Rate rejection returns `429` with an empty body and `Retry-After: 1`; exhausted quotas return `200 {"error":"Owner account is locked. Events are not being recorded."}` to stop SDK retries. An exhausted app is rejected before its body is read. Batches exceeding the remaining quota are rejected as a whole. Only valid events reserve quota, before Analytics Engine submission; failed writes and duplicate retries can consume quota. Raising the limit resumes ingestion; month rollover resets it automatically. Unlike Aptabase’s account-wide allowance, this project gives each app its own allowance.

To pause an app, add `"disabled": true` to its entry in `APPS`. This blocks every key mapped to that app ID before reading the body. Remove the flag to resume. Missing and unknown keys are also rejected before body parsing. Public SDK keys cannot prove that events came from real users; limits reduce abuse rather than eliminate it.

### Previews and staging

Preview builds use a separate Analytics Engine dataset and isolated Durable Object counters. To accept events on preview URLs, add the `APPS` variable to **Previews Base** in Cloudflare; production variables are not inherited. Optional limit overrides can be set there too.

For staging, connect a second Worker to a `staging` branch. Set its deploy command to `node scripts/deploy.mjs staging`, add its `APPS` runtime variable, and set its `WORKER_URL` build variable to the staging URL. The configuration in `wrangler.staging.jsonc` uses the `aptabase_events_v1_staging` dataset.

### Deployment behavior

Workers Builds supplies the Worker name and provisions the Analytics Engine binding and SQLite-backed Durable Objects. The default `npm run build` validates formatting, dependencies, types, tests, and the Worker bundle before deployment. GitHub Actions runs tests only.

### Verify an event without an SDK

Replace the URL and key with your own values:

```sh
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/v0/event \
  -H 'Content-Type: application/json' \
  -H 'App-Key: A-SH-MYAPP' \
  --data "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"sessionId\":\"manual-check-1\",\"eventName\":\"first_event\"}"
```

A successful request returns `200 {}`.

## SDK setup

Web (`@aptabase/web`):

```ts
import * as Aptabase from "@aptabase/web";

Aptabase.init("A-SH-MYAPP", {
  host: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
});
Aptabase.trackEvent("button_clicked", { button: "signup", enabled: true });
```

Swift (`Aptabase`):

```swift
import Aptabase

Aptabase.shared.initialize(appKey: "A-SH-MYAPP", with: InitOptions(
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

This project provides event ingestion. To view event reports, query Analytics Engine or connect your own dashboard. Cloudflare Worker metrics show service operation rather than Aptabase event charts.

Successful ingestion returns `200 {}` when valid data points have been submitted to the binding. Analytics Engine writes are non-blocking and provide no persistence acknowledgment; see [Cloudflare's write example](https://developers.cloudflare.com/workers/examples/analytics-engine/). A synchronous binding error returns 503; a partial batch write can cause duplicates if clients retry. There is no deduplication or durable queue.

Analytics Engine samples data and retains it for **three months**, per its [limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/). Sampling is grouped by stable app ID. Use sampling-aware SQL for aggregates. Do not treat this service as a lossless event archive. See [protocol and data layout](docs/protocol.md), [privacy](docs/privacy.md), and [release verification and rollback](docs/verification.md).

Request logs contain only aggregate event counts and fixed reason codes. Workers Observability is enabled at a 10% head sampling rate. Crawler directives and optional endpoint WAF restrictions are described in [WAF guidance](docs/waf.md). Cloudflare may collect platform request metadata independently; configure platform access and retention appropriately. Health checks validate configuration and binding presence without writing an event or proving storage availability.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reporting: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).
