import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { claimChainRead, listChainObservations, saveChainObservation } from "./chain-observations.ts";
import type { PricedObservation } from "../lib/chain-analysis.ts";

test("actual SQL isolates saved records and atomically gates each user",async()=>{
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE chain_observations(id TEXT PRIMARY KEY,owner_ref TEXT,address TEXT,record_json TEXT,created_at TEXT); CREATE TABLE chain_read_gates(owner_ref TEXT PRIMARY KEY,next_available_at TEXT);");
  const db = { prepare(query: string) { return { bind(...args: (string | number)[]) {
    return { async run() { const result=sql.prepare(query).run(...args);return { meta:{changes:Number(result.changes)} }; },
      async all() { return { results: sql.prepare(query).all(...args) }; } };
  } }; } } as unknown as D1Database;
  const record = { id:"a",address:"0xabc",observedAt:new Date().toISOString(),executionReady:false } as PricedObservation;
  await saveChainObservation(db,"owner-a",record);
  await saveChainObservation(db,"owner-b",{...record,id:"b"});
  assert.deepEqual((await listChainObservations(db,"owner-a")).map(r=>r.id),["a"]);
  assert.deepEqual(await listChainObservations(db,"stranger"),[]);
  assert.deepEqual(await listChainObservations(db,"owner-a","different"),[]);
  assert.equal(await claimChainRead(db,"owner-a"),true);
  assert.equal(await claimChainRead(db,"owner-a"),false);
  assert.equal(await claimChainRead(db,"owner-b"),true);
  sql.exec("UPDATE chain_read_gates SET next_available_at='2000-01-01T00:00:00.000Z'");
  assert.equal(await claimChainRead(db,"owner-a"),true);
  sql.close();
});
