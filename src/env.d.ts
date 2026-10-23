// Runtime settings are managed in the Cloudflare dashboard, outside Wrangler vars.
declare namespace Cloudflare {
  interface Env {
    APPS?: string;
    MAX_BODY_BYTES?: string;
    RATE_LIMIT_PER_SECOND?: string;
    MONTHLY_EVENT_LIMIT?: string;
  }
}
interface Env extends Cloudflare.Env {}
