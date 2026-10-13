ALTER TABLE autonomous_transaction_journal ADD COLUMN settled_state TEXT CHECK(settled_state IN ('confirmed','reverted'));
