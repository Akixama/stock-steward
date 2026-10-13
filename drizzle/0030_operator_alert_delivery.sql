CREATE TABLE autonomous_alert_deliveries (
 incident_id TEXT PRIMARY KEY NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 lease_token TEXT,
 lease_until TEXT,
 delivered_at TEXT,
 exhausted_at TEXT
);
CREATE INDEX autonomous_alert_delivery_due ON autonomous_alert_deliveries(delivered_at,exhausted_at,next_attempt_at);
