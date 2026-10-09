import type { DecisionLedger } from "../lib/broker-boundary.ts";
import { addOrderEvent, type DecisionReceipt, type Mandate, type OrderEvent } from "../lib/decision.ts";

/** Server-only D1 store. Callers must establish and authorize ownerRef before use. */
export class D1DecisionLedger implements DecisionLedger {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async getMandate(ownerRef: string): Promise<Mandate | null> {
    const row = await this.db.prepare("SELECT policy_json FROM mandates WHERE owner_ref = ? ORDER BY version DESC LIMIT 1")
      .bind(ownerRef).first<{ policy_json: string }>();
    return row ? JSON.parse(row.policy_json) as Mandate : null;
  }

  // Raw snapshot for policy-lease drift checks; the digest domain is owner + version + raw JSON.
  async getMandateSnapshot(ownerRef: string): Promise<{ owner: string; version: number; policyJson: string } | null> {
    const row = await this.db.prepare("SELECT owner_ref, version, policy_json FROM mandates WHERE owner_ref = ? ORDER BY version DESC LIMIT 1")
      .bind(ownerRef).first<{ owner_ref: string; version: number; policy_json: string }>();
    return row ? { owner: row.owner_ref, version: row.version, policyJson: row.policy_json } : null;
  }

  async saveMandate(ownerRef: string, mandate: Mandate): Promise<void> {
    if (!ownerRef || mandate.version < 1 || mandate.requireApproval !== true ||
      (mandate.executionPreference !== undefined && !["approval", "automatic"].includes(mandate.executionPreference))) {
      throw new Error("Invalid account-bound mandate.");
    }
    await this.db.prepare("INSERT INTO mandates (owner_ref, version, policy_json, created_at) VALUES (?, ?, ?, ?)")
      .bind(ownerRef, mandate.version, JSON.stringify(mandate), new Date().toISOString()).run();
  }

  async saveDecision(ownerRef: string, receipt: DecisionReceipt): Promise<void> {
    if (!ownerRef || !receipt.id || receipt.evidence.accountRef.length === 0) throw new Error("Invalid decision receipt.");
    await this.db.prepare("INSERT INTO decision_receipts (id, owner_ref, account_ref, policy_version, status, receipt_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(receipt.id, ownerRef, receipt.evidence.accountRef, receipt.policyVersion, receipt.status, JSON.stringify(receipt), receipt.createdAt).run();
  }

  async getDecision(ownerRef: string, receiptId: string): Promise<DecisionReceipt | null> {
    const row = await this.db.prepare("SELECT receipt_json FROM decision_receipts WHERE owner_ref = ? AND id = ?")
      .bind(ownerRef, receiptId).first<{ receipt_json: string }>();
    if (!row) return null;
    const receipt = JSON.parse(row.receipt_json) as DecisionReceipt;
    const events = await this.db.prepare("SELECT event_json FROM order_events WHERE owner_ref = ? AND receipt_id = ? ORDER BY sequence ASC")
      .bind(ownerRef, receiptId).all<{ event_json: string }>();
    return { ...receipt, orderEvents: events.results.map((event) => JSON.parse(event.event_json) as OrderEvent) };
  }

  async listDecisions(ownerRef: string, limit = 50): Promise<DecisionReceipt[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await this.db.prepare("SELECT receipt_json FROM decision_receipts WHERE owner_ref = ? ORDER BY created_at DESC LIMIT ?")
      .bind(ownerRef, safeLimit).all<{ receipt_json: string }>();
    return Promise.all(rows.results.map(async (row) => {
      const receipt = JSON.parse(row.receipt_json) as DecisionReceipt;
      return (await this.getDecision(ownerRef, receipt.id))!;
    }));
  }

  async appendOrderEvent(ownerRef: string, receiptId: string, event: OrderEvent): Promise<DecisionReceipt> {
    const receipt = await this.getDecision(ownerRef, receiptId);
    if (!receipt) throw new Error("Receipt not found for this account owner.");
    const updated = addOrderEvent(receipt, event);
    // Sequence is unique. A concurrent append fails closed and must be retried from a fresh receipt.
    await this.db.prepare("INSERT INTO order_events (receipt_id, sequence, owner_ref, event_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(receiptId, updated.orderEvents.length, ownerRef, JSON.stringify(event), event.at).run();
    return updated;
  }

  async claimOrderAttempt(ownerRef: string, accountRef: string, receiptId: string,
    observedAt: string, now = new Date()): Promise<void> {
    const observed = new Date(observedAt).toISOString();
    const result = await this.db.prepare(`INSERT INTO account_order_gates
      (owner_ref, account_ref, active_receipt_id, last_completed_at, updated_at)
      VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT(owner_ref, account_ref) DO UPDATE SET
        active_receipt_id = excluded.active_receipt_id, updated_at = excluded.updated_at
      WHERE account_order_gates.active_receipt_id IS NULL AND
        (account_order_gates.last_completed_at IS NULL OR account_order_gates.last_completed_at < ?)`)
      .bind(ownerRef, accountRef, receiptId, now.toISOString(), observed).run();
    if (result.meta.changes !== 1) {
      throw new Error("Another order is pending or this decision predates the last order. Refresh the broker and create a new decision.");
    }
  }

  async releaseOrderAttempt(ownerRef: string, accountRef: string, receiptId: string,
    now = new Date()): Promise<void> {
    await this.db.prepare(`UPDATE account_order_gates SET active_receipt_id = NULL,
      last_completed_at = ?, updated_at = ?
      WHERE owner_ref = ? AND account_ref = ? AND active_receipt_id = ?`)
      .bind(now.toISOString(), now.toISOString(), ownerRef, accountRef, receiptId).run();
  }
}
