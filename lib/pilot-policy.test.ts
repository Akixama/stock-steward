import test from "node:test";
import assert from "node:assert/strict";
import { validatePilotMandate } from "./pilot-policy.ts";

const base = { maxOrderCents: 1_000, maxDailyBuyCents: 5_000, requireApproval: true as const, executionPreference: "approval" as const };

test("exact pilot caps pass", () => {
  assert.equal(validatePilotMandate(base).ok, true);
});

test("smaller limits pass", () => {
  assert.equal(validatePilotMandate({ ...base, maxOrderCents: 500, maxDailyBuyCents: 2_000 }).ok, true);
});

test("anything above $10 a trade or $50 a day fails closed", () => {
  assert.equal(validatePilotMandate({ ...base, maxOrderCents: 1_001 }).ok, false);
  assert.equal(validatePilotMandate({ ...base, maxDailyBuyCents: 5_001 }).ok, false);
  assert.equal(validatePilotMandate({ ...base, maxDailyBuyCents: 500 }).ok, false);
});

test("automatic mode or missing approval fails closed", () => {
  assert.equal(validatePilotMandate({ ...base, executionPreference: "automatic" }).ok, false);
  assert.equal(validatePilotMandate({ ...base, requireApproval: false }).ok, false);
  assert.equal(validatePilotMandate(null).ok, false);
});
