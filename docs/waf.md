# Crawler directives and WAF

The receiver serves `GET /robots.txt` (and HEAD) with `User-agent: *` and `Disallow: /`, and adds `X-Robots-Tag: noindex` to Worker responses. These directives are voluntary. A crawler blocked by robots.txt may never fetch the noindex header; neither directive authenticates clients or stops malicious POSTs.

## Paths to retain

| Path             | Methods       | Caller                                                                   |
| ---------------- | ------------- | ------------------------------------------------------------------------ |
| `/api/v0/event`  | POST, OPTIONS | Pinned Web/shared JavaScript SDK; browser CORS preflight                 |
| `/api/v0/events` | POST, OPTIONS | Pinned Swift SDK; batch-compatible SDKs; browser preflight if applicable |
| `/healthz`       | GET           | Deployment verification and monitoring                                   |
| `/robots.txt`    | GET, HEAD     | Cooperative crawlers                                                     |

Event POSTs use `Content-Type: application/json` and `App-Key`. Browser OPTIONS requests do not carry the actual App-Key header. SDK traffic comes from users' devices, not fixed Aptabase server IPs. Native SDKs may omit Origin and Referer and use OS-specific User-Agent strings. The pinned SDK sources are linked in [compatibility.md](compatibility.md). This receiver implements event ingestion only; feature-flag, error-reporting, dashboard and other Aptabase APIs are outside this allowlist.

## Optional WAF path/method rule

Use a dedicated proxied custom hostname in your own Cloudflare zone, such as `stats.example.com`. Your zone's WAF rules do not cover the existing `*.workers.dev` hostname. Configure and verify the custom hostname first, update all SDK hosts, then disable the production workers.dev route and unused preview/version endpoints as appropriate. Do not disable the current host while clients still use it. Persist routing changes in Wrangler and deploy through CI. See [Workers routing](https://developers.cloudflare.com/workers/configuration/routing/) and [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

In that domain's Security rules, create a custom rule with action **Block** and this expression, replacing the example hostname:

```text
(http.host eq "stats.example.com" and not (
  (http.request.uri.path in {"/api/v0/event" "/api/v0/events"}
    and http.request.method in {"POST" "OPTIONS"})
  or (http.request.uri.path eq "/healthz" and http.request.method eq "GET")
  or (http.request.uri.path eq "/robots.txt" and http.request.method in {"GET" "HEAD"})
))
```

This rejects unrelated paths and methods before the Worker runs. Query strings do not change the path allowlist. It does not require a plan-specific regular expression. Scope the rule to the dedicated hostname, never the entire app website. Keep the Worker's existing JSON, key, body-size, Origin and quota validation; duplicating those parsers in WAF is unnecessary for the basic rule.

An optional stricter rule can require App-Key on event POSTs; use the [official header matching syntax](https://developers.cloudflare.com/waf/custom-rules/use-cases/require-specific-headers/). It changes missing-key responses from the receiver's compatible 200 error JSON to a WAF block response. Do not apply key or Content-Type requirements to OPTIONS. Keep key rotation in the Worker's APPS configuration instead of duplicating a key allowlist in WAF.

WAF blocks may use a different status/body from the receiver. Validate Web OPTIONS/POST, Swift batch POST, health and robots after enabling the rule. Do not use Managed Challenge, JavaScript challenges, or a login wall on ingestion endpoints. Cloudflare warns that [Bot Fight Mode can challenge API/mobile traffic](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/).

## Authentication limits

A public SDK key, User-Agent, Origin, path and JSON shape can all be copied. This rule allows requests matching the SDK protocol; it cannot guarantee that an official SDK sent them. Do not block requests merely because Origin/Referer is missing or User-Agent lacks the word Aptabase. Do not allowlist Aptabase server IPs: real events originate on users' devices.

Keep IP rate limits and per-app quotas. If genuine client authentication becomes necessary, introduce a trusted backend issuing short-lived scoped credentials or platform attestation and account for replay, offline delivery and SDK changes. A permanent secret embedded in a public SDK is not a reliable solution.
