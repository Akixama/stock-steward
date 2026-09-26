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
