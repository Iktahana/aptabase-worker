import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: { bindings: { APPS: '{"A-SH-TEST":{"id":"test"}}' } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
