import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mandates = sqliteTable("mandates", {
  ownerRef: text("owner_ref").notNull(),
  version: integer("version").notNull(),
  policyJson: text("policy_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerRef, table.version] })]);

export const decisionReceipts = sqliteTable("decision_receipts", {
  id: text("id").primaryKey(),
  ownerRef: text("owner_ref").notNull(),
  accountRef: text("account_ref").notNull(),
  policyVersion: integer("policy_version").notNull(),
  status: text("status", { enum: ["held", "awaiting_approval"] }).notNull(),
  receiptJson: text("receipt_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("decision_receipts_owner_created_idx").on(table.ownerRef, table.createdAt)]);

export const orderEvents = sqliteTable("order_events", {
  receiptId: text("receipt_id").notNull(),
  sequence: integer("sequence").notNull(),
  ownerRef: text("owner_ref").notNull(),
  eventJson: text("event_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.receiptId, table.sequence] })]);

export const accountOrderGates = sqliteTable("account_order_gates", {
  ownerRef: text("owner_ref").notNull(),
  accountRef: text("account_ref").notNull(),
  activeReceiptId: text("active_receipt_id"),
  lastCompletedAt: text("last_completed_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerRef, table.accountRef] })]);

export const brokerConnections = sqliteTable("broker_connections", {
  ownerRef: text("owner_ref").primaryKey(),
  broker: text("broker").notNull(),
  accountRef: text("account_ref").notNull(),
  environment: text("environment").notNull(),
  tradingScope: integer("trading_scope", { mode: "boolean" }).notNull().default(false),
  tokenIv: text("token_iv").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  connectedAt: text("connected_at").notNull(),
});

export const dataDeletionRequests = sqliteTable("data_deletion_requests", {
  ownerRef: text("owner_ref").primaryKey(),
  email: text("email").notNull(),
  requestedAt: text("requested_at").notNull(),
  state: text("state", { enum: ["requested", "reviewing", "completed"] }).notNull().default("requested"),
});

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(), ownerRef: text("owner_ref").notNull(),
  accountRef: text("account_ref").notNull(), recordJson: text("record_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("observations_owner_created_idx").on(table.ownerRef, table.createdAt)]);

export const chainObservations = sqliteTable("chain_observations", {
 id: text("id").primaryKey(), ownerRef: text("owner_ref").notNull(), address: text("address").notNull(), recordJson: text("record_json").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [index("chain_observations_owner_address_created_idx").on(table.ownerRef, table.address, table.createdAt)]);
export const chainReadGates = sqliteTable("chain_read_gates", { ownerRef: text("owner_ref").primaryKey(), nextAvailableAt: text("next_available_at").notNull() });
export const autonomyRuns = sqliteTable('autonomy_runs', {
  id:text('id').primaryKey(),ownerRef:text('owner_ref').notNull(),address:text('address').notNull(),receiptJson:text('receipt_json').notNull(),createdAt:text('created_at').notNull(),
}, table=>[index('autonomy_runs_owner_created_idx').on(table.ownerRef,table.createdAt)]);
export const autonomySpends = sqliteTable('autonomy_spends', {
  ownerRef:text('owner_ref').notNull(),address:text('address').notNull(),executionDay:text('execution_day').notNull(),intentId:text('intent_id').notNull(),amountCents:integer('amount_cents').notNull(),state:text('state').notNull(),
}, table=>[primaryKey({columns:[table.ownerRef,table.address,table.intentId]}),index('autonomy_spends_daily_idx').on(table.ownerRef,table.address,table.executionDay)]);
export const autonomySchedules = sqliteTable('autonomy_schedules', {
  ownerRef:text('owner_ref').primaryKey(),address:text('address').notNull(),intervalMinutes:integer('interval_minutes').notNull(),
  enabled:integer('enabled').notNull(),revision:integer('revision').notNull(),nextDueAt:text('next_due_at').notNull(),
  leaseToken:text('lease_token'),leaseUntil:text('lease_until'),lastAttemptAt:text('last_attempt_at'),lastSuccessAt:text('last_success_at'),
  failureCount:integer('failure_count').notNull().default(0),lastError:text('last_error'),updatedAt:text('updated_at').notNull(),
});
export const autonomyWorkerRuns = sqliteTable('autonomy_worker_runs', {
  id:text('id').primaryKey(),ownerRef:text('owner_ref').notNull(),address:text('address').notNull(),revision:integer('revision').notNull(),
  dueAt:text('due_at').notNull(),startedAt:text('started_at').notNull(),completedAt:text('completed_at'),status:text('status').notNull(),
  attemptToken:text('attempt_token').notNull(),attempts:integer('attempts').notNull(),observationId:text('observation_id'),receiptId:text('receipt_id'),detail:text('detail'),
}, table=>[index('autonomy_worker_runs_owner_started_idx').on(table.ownerRef,table.startedAt)]);
export const autonomyWorkerHealth = sqliteTable('autonomy_worker_health', {
  id:text('id').primaryKey(),leaseUntil:text('lease_until'),leaseToken:text('lease_token'),lastStartedAt:text('last_started_at'),lastCompletedAt:text('last_completed_at'),
  lastSummary:text('last_summary'),
});
export const chainTransactionWatches = sqliteTable('chain_transaction_watches', {
  id:text('id').primaryKey(),ownerRef:text('owner_ref').notNull(),address:text('address').notNull(),transactionHash:text('transaction_hash').notNull(),
  recordJson:text('record_json').notNull(),createdAt:text('created_at').notNull(),checkedAt:text('checked_at').notNull(),
}, table=>[index('chain_transaction_watches_owner_checked_idx').on(table.ownerRef,table.checkedAt)]);
