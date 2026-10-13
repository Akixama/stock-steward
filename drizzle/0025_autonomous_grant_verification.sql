ALTER TABLE autonomous_session_grants ADD COLUMN creation_transaction TEXT;
ALTER TABLE autonomous_session_grants ADD COLUMN grant_transaction TEXT;
ALTER TABLE autonomous_session_grants ADD COLUMN verified_at TEXT;
