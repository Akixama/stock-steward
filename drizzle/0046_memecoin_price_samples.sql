-- Steward's own memecoin price history for the Markets chart (display only).
-- One price per coin per 5-minute slot, read from the coin's pool on chain,
-- in micro-USD per whole token.
CREATE TABLE IF NOT EXISTS memecoin_price_samples (
  symbol TEXT NOT NULL,
  bucket TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  PRIMARY KEY (symbol, bucket)
);
