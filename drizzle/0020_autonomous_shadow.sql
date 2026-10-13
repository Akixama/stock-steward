CREATE TABLE autonomous_shadow_plans (
 owner_ref TEXT PRIMARY KEY NOT NULL,
 revision INTEGER NOT NULL,
 rule_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 next_due_at TEXT NOT NULL,
 lease_token TEXT,
 lease_until TEXT,
 failures INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE TABLE autonomous_shadow_runs (
 id TEXT PRIMARY KEY NOT NULL,
 owner_ref TEXT NOT NULL,
 revision INTEGER NOT NULL,
 due_at TEXT NOT NULL,
 claim_token TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','canceled','error')),
 decision_json TEXT,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 UNIQUE(owner_ref,revision,due_at)
);
CREATE INDEX autonomous_shadow_due ON autonomous_shadow_plans(enabled,next_due_at);
CREATE INDEX autonomous_shadow_history ON autonomous_shadow_runs(owner_ref,created_at);
