-- Referral program: one invite code per account, one referrer per new account.
CREATE TABLE IF NOT EXISTS referral_codes (
  owner_ref TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
  referred_ref TEXT PRIMARY KEY,
  referrer_ref TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_ref, created_at);
