// @ts-check
// Public runtime configuration (no secrets). Convex deployment URLs are public by design.

/** Development deployment (project "manageyourstall", team viraj-vishwakarma). Local runs and tests always use it. */
const DEV_URL = 'https://descriptive-gull-970.convex.cloud';

/**
 * Production deployment for the live site. Empty until `npx convex deploy` has created it — then paste its
 * https://<name>.convex.cloud URL here and the live site switches over (local runs keep using DEV_URL).
 */
const PROD_URL = 'https://elegant-marlin-486.convex.cloud';

const host = typeof location !== 'undefined' ? location.hostname : '';
const isLocal = !host || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || host.endsWith('.localhost');

/** Convex deployment URL for accounts & cloud stalls ('' = cloud features hidden). */
export const CONVEX_URL = isLocal ? DEV_URL : (PROD_URL || DEV_URL);
