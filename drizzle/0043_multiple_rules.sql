-- Several automatic rules per owner. Existing rules become rule_id 'main' and
-- keep their revision, schedule and history.
CREATE TABLE autonomous_shadow_plans_v2 (
 owner_ref TEXT NOT NULL,
 rule_id TEXT NOT NULL DEFAULT 'main',
 revision INTEGER NOT NULL,
 rule_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 next_due_at TEXT NOT NULL,
 lease_token TEXT,
 lease_until TEXT,
 failures INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_ref, rule_id)
);
INSERT INTO autonomous_shadow_plans_v2(owner_ref,rule_id,revision,rule_json,enabled,next_due_at,lease_token,lease_until,failures,updated_at)
 SELECT owner_ref,'main',revision,rule_json,enabled,next_due_at,lease_token,lease_until,failures,updated_at FROM autonomous_shadow_plans;
DROP TABLE autonomous_shadow_plans;
ALTER TABLE autonomous_shadow_plans_v2 RENAME TO autonomous_shadow_plans;
CREATE INDEX autonomous_shadow_due ON autonomous_shadow_plans(enabled,next_due_at);

CREATE TABLE autonomous_shadow_runs_v2 (
 id TEXT PRIMARY KEY NOT NULL,
 owner_ref TEXT NOT NULL,
 rule_id TEXT NOT NULL DEFAULT 'main',
 revision INTEGER NOT NULL,
 due_at TEXT NOT NULL,
 claim_token TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','canceled','error')),
 decision_json TEXT,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 UNIQUE(owner_ref,rule_id,revision,due_at)
);
INSERT INTO autonomous_shadow_runs_v2(id,owner_ref,rule_id,revision,due_at,claim_token,state,decision_json,created_at,completed_at)
 SELECT id,owner_ref,'main',revision,due_at,claim_token,state,decision_json,created_at,completed_at FROM autonomous_shadow_runs;
DROP TABLE autonomous_shadow_runs;
ALTER TABLE autonomous_shadow_runs_v2 RENAME TO autonomous_shadow_runs;
CREATE INDEX autonomous_shadow_history ON autonomous_shadow_runs(owner_ref,created_at);
