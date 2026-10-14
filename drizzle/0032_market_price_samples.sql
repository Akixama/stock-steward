CREATE TABLE IF NOT EXISTS market_price_samples (
  symbol TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  bid_cents INTEGER NOT NULL,
  ask_cents INTEGER NOT NULL,
  PRIMARY KEY (symbol, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_market_price_samples_observed ON market_price_samples (observed_at);
