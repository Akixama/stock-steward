CREATE TABLE IF NOT EXISTS autonomous_strategy_prices (
 owner_ref TEXT NOT NULL,
 address TEXT NOT NULL,
 symbol TEXT NOT NULL,
 observation_slot TEXT NOT NULL,
 block_hash TEXT NOT NULL,
 price_at TEXT NOT NULL,
 share_upper_micro_usd TEXT NOT NULL,
 PRIMARY KEY(owner_ref,address,symbol,observation_slot)
);
