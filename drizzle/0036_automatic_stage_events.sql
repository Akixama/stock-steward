CREATE TABLE automatic_stage_events (
 id TEXT PRIMARY KEY NOT NULL,
 owner_ref TEXT NOT NULL,
 run_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('proposal','auto_started','auto_action')),
 status TEXT NOT NULL CHECK(status IN ('proposed','checking','blocked','submitted','unknown')),
 symbol TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000),
 detail TEXT NOT NULL,
 transaction_hash TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 UNIQUE(run_id,kind)
);
-- Old archived shadow plans must not start running merely because Shadow is
-- released again. The owner explicitly resumes a plan in the new workspace.
UPDATE autonomous_shadow_plans SET enabled=0,lease_token=NULL,lease_until=NULL WHERE enabled=1;
CREATE INDEX automatic_stage_events_owner ON automatic_stage_events(owner_ref,created_at);
CREATE TABLE automatic_stage_deliveries (
 event_id TEXT NOT NULL,
 subscription_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','sent')),
 attempts INTEGER NOT NULL DEFAULT 0,
 claimed_at TEXT,
 sent_at TEXT,
 PRIMARY KEY(event_id,subscription_id)
);
