CREATE TABLE IF NOT EXISTS trade_agreements (
  owner_ref TEXT PRIMARY KEY,
  terms_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  non_us_person INTEGER NOT NULL CHECK (non_us_person = 1)
);
