# Operator alert receiver setup

Delivery remains disabled until a recipient is explicitly approved. This connector sends status incidents, not wallet identity, balances, keys or raw signed transactions. Incident IDs are stable idempotency keys. At-least-once delivery means the receiver must deduplicate; a timeout after acceptance can produce a duplicate delivery.

Set STEWARD_OPERATOR_ALERT_URL to an approved HTTPS endpoint, STEWARD_OPERATOR_ALERT_SECRET to a cryptographically random 32-byte hex signing key, and STEWARD_OPERATOR_ALERTS_ENABLED=true only after authorization. Keep the key in Worker secrets. Never put it in the browser bundle or docs. Receipt and execution processing remain independent from delivery failure.

The receiver must verify X-Steward-Signature as lowercase hex HMAC-SHA256 over X-Steward-Timestamp + '.' + the exact UTF-8 request body, using the shared key. Reject old timestamps (e.g. more than five minutes), compare signatures in constant time, persist Idempotency-Key before acknowledging, and respond with 2xx only after acceptance. Redirects are rejected. Each delivery has a 5-second timeout and a 30-second database lease. Failed deliveries retry with exponential delays, at most five attempts. Crashed last attempts become exhausted once their lease expires.

Inspect autonomous_alert_deliveries for exhausted_at IS NOT NULL AND delivered_at IS NULL. Exhaustion needs operator investigation; it cannot cancel, resubmit or release a financial order. In-app incidents remain available even when delivery is disabled or exhausted. An approved receiver should also monitor the runner independently: this same runner cannot alert if it never runs.

Apply drizzle/0030_operator_alert_delivery.sql before enabling delivery. Tests use an isolated database and stub network only. No real notification recipient has been configured or contacted.
