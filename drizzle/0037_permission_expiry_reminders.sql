CREATE TABLE permission_expiry_deliveries (
 owner_ref TEXT NOT NULL,
 safe TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 subscription_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','sent')),
 attempts INTEGER NOT NULL DEFAULT 0,
 claimed_at TEXT,
 sent_at TEXT,
 PRIMARY KEY(owner_ref,safe,expires_at,subscription_id)
);
CREATE INDEX permission_expiry_deliveries_pending ON permission_expiry_deliveries(status,claimed_at);
