-- Last good Markets data for the hand-checked memecoins (display only).
-- Third-party price APIs throttle Cloudflare's shared servers, so the
-- background check saves a copy here and pages read it instead of calling them.
CREATE TABLE IF NOT EXISTS memecoin_market_cache (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  complete INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
