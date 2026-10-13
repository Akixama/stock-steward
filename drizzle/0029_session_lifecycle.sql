CREATE TABLE autonomous_session_archive (
 id TEXT PRIMARY KEY NOT NULL, owner_ref TEXT NOT NULL, account_address TEXT NOT NULL,
 grant_json TEXT NOT NULL, retirement_json TEXT NOT NULL, retired_at TEXT NOT NULL
);
CREATE INDEX autonomous_session_archive_owner ON autonomous_session_archive(owner_ref,retired_at);
