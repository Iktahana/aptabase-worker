# Contributing

Use Node.js 24.22.1 or a later Node 24 security patch and npm. Run `npm ci`, copy `.dev.vars.example` to `.dev.vars`, and use `npm run dev` for local development. Keep runtime dependencies limited to platform APIs and small pure validation functions.

Before opening a pull request, run `npm run format` and `npm run check`. Regenerate Wrangler types after configuration changes. Tests run inside workerd through Cloudflare's Vitest integration; mocks capture submitted data points and exercise synchronous binding failures. Keep fixtures attributed to their exact SDK source revisions. Add regression cases for protocol changes, byte limits, and privacy.

Use English for documentation, code comments, and errors. Preserve the published dataset column meanings. Never commit `.dev.vars`, credentials, payload logs, or generated build output. GitHub Actions runs tests only. Cloudflare Workers Builds handles production releases; local activity is limited to implementation, tests, builds, dry runs, and release verification. Do not publish this private package to npm.
