# Release verification and rollback

## Automated checks

Run `npm ci` followed by `npm run check`. CI also builds both named environments with Wrangler dry runs. Tests execute in Workers' workerd runtime and cover both pinned SDK fixtures, multi-app routing and rotation, fixed schema mapping, debug flags, partial batches, failure responses, streaming size limits, UTF-8 boundaries, CORS, and sensitive-data exclusion from application logs.

## First staging acceptance

1. Configure the `staging` GitHub Environment as described in the README. Run **Check and release** on `main`, choosing `staging` / `deploy`. Confirm the CI health step passes. Health checks cannot prove storage persistence.
2. Run an actual Web SDK application against the staging host with its own `A-SH-*` key. Send `staging_web_check` with boolean property `enabled: true` and `isDebug: true`. Record the package version, commit, UTC send time, and workflow run URL. Avoid personal data.
3. Run an actual Swift SDK application with the pinned revision or record the tested version. Set `InitOptions(host: "YOUR_STAGING_BASE_URL", trackingMode: .asRelease)`. Send `staging_swift_check` and allow its flush interval to complete. Record version and UTC time.
4. Using a separate account-scoped **read-only Analytics Engine token**, query the Analytics Engine SQL API from a private terminal or your preferred SQL client. Do not commit the token. The deployment token does not need SQL read access. Allow for data visibility delay. Example SQL:

   ```sql
   SELECT timestamp, index1, blob1, blob2, blob3, blob4,
          blob5, blob6, blob7, blob8, blob9, blob10, blob11,
          blob12, blob13, blob14, blob15, blob16, blob17,
          double1, double2, _sample_interval
   FROM aptabase_events_v1_staging
   WHERE timestamp > NOW() - INTERVAL '1' HOUR
     AND blob3 IN ('staging_web_check', 'staging_swift_check')
   ORDER BY timestamp DESC
   LIMIT 25
   ```

   Submit this as a POST body to `https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/analytics_engine/sql` with `Authorization: Bearer YOUR_READ_ONLY_TOKEN`. See the [SQL API reference](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/).
5. Verify index1 and blob2 match each stable app ID; the session remains a string in blob4; Web boolean props are in blob16; Swift native fields are in blob6–11; double1 matches the client send time in milliseconds; double2 is 1 for the Web debug event and 0 for Swift release. Check country/region where available. Sampling can omit specific rows; absence is not proof of rejection. Use low-volume test apps, retry with distinct event names, and investigate if no rows become visible.
6. Save an acceptance record with the above evidence and redacted row excerpts in your private release notes. Then permit production release. This repository does not claim real-SDK staging acceptance until those steps have been performed.

## Rollback in CI

Find a known-good version UUID in Cloudflare's Worker deployment history (read-only inspection). In GitHub Actions run **Check and release** on `main`, choose the correct environment, select `rollback`, and paste the exact UUID. The workflow uses the same deployment concurrency lock, environment secrets, pinned actions, and health verification as deployments. It requires no local publishing credentials.

Rollback restores the selected Worker version and its versioned configuration/secrets, including the earlier `APPS` value. It does not undo Analytics Engine writes. Review key rotations before rollback; the next push to `main` automatically redeploys the current main code and environment secret configuration. Health failure marks the workflow failed; rollback is an explicit manual operation.
