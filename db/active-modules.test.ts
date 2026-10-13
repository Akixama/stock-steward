import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { getActiveModule, saveActiveModule } from "./active-modules.ts";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE active_modules(owner_ref TEXT NOT NULL,mandate_version INTEGER NOT NULL,safe TEXT NOT NULL,module TEXT NOT NULL,verified_at TEXT NOT NULL,PRIMARY KEY(owner_ref,mandate_version));");
  sql.exec(readFileSync(new URL('../drizzle/0018_active_module_outputs.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../drizzle/0019_active_module_window.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(query: string) {
      let values: (string | number | null)[] = [];
      const statement = {
        bind(...args: (string | number | null)[]) { values = args; return statement; },
        async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; },
        async first() { return sql.prepare(query).get(...values) ?? null; },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, sql };
}

test("a verified module round-trips per mandate version", async () => {
  const { db, sql } = fixture();
  try {
    assert.equal(await getActiveModule(db, "u1", 4), null);
    await saveActiveModule(db, "u1", 4, "0x123b44550990C3d61c9A7954CcAf820040A145eb", "0x6E675A20011ee3562e50f7818ac852217eabbc0d");
    const found = await getActiveModule(db, "u1", 4);
    assert.equal(found?.module, "0x6e675a20011ee3562e50f7818ac852217eabbc0d");
    assert.equal(found?.safe, "0x123b44550990c3d61c9a7954ccaf820040a145eb");
    assert.equal(await getActiveModule(db, "u1", 5), null);
    assert.equal(await getActiveModule(db, "u2", 4), null);
  } finally { sql.close(); }
});

test("re-verification overwrites the same version, malformed addresses refuse", async () => {
  const { db, sql } = fixture();
  try {
    await saveActiveModule(db, "u1", 4, "0x123b44550990C3d61c9A7954CcAf820040A145eb", "0x6E675A20011ee3562e50f7818ac852217eabbc0d");
    await saveActiveModule(db, "u1", 4, "0x123b44550990C3d61c9A7954CcAf820040A145eb", "0x9BF7f4aDd0e2FD5559B66d68C101D1Ec6B5EeE2e");
    assert.equal((await getActiveModule(db, "u1", 4))?.module, "0x9bf7f4add0e2fd5559b66d68c101d1ec6b5eee2e");
    await assert.rejects(saveActiveModule(db, "u1", 4, "bad", "0x6E675A20011ee3562e50f7818ac852217eabbc0d"));
  } finally { sql.close(); }
});

test("activation preserves the installed pool and floor and rejects invalid replacements", async () => {
  const { db, sql } = fixture();
  const safe = "0x123b44550990C3d61c9A7954CcAf820040A145eb";
  const moduleAddress = "0x6E675A20011ee3562e50f7818ac852217eabbc0d";
  const outputs = [{ token: safe, fee: 3000, tickSpacing: 60, minimumOutputRaw: "123456789" }];
  try {
    await saveActiveModule(db, "u1", 4, safe, moduleAddress, outputs);
    assert.equal((await getActiveModule(db, "u1", 4))?.outputs?.[0].minimumOutputRaw, "123456789");
    await assert.rejects(saveActiveModule(db, "u1", 4, safe, moduleAddress, [{ ...outputs[0], minimumOutputRaw: "0" }]));
    assert.equal((await getActiveModule(db, "u1", 4))?.outputs?.[0].minimumOutputRaw, "123456789");
  } finally { sql.close(); }
});

test('permission recovery preserves its installed window across UTC midnight',async()=>{const {db,sql}=fixture();try{const safe='0x123b44550990c3d61c9a7954ccaf820040a145eb',address='0x6e675a20011ee3562e50f7818ac852217eabbc0d';const original={startsAt:1791590400,expiresAt:1791763200};await saveActiveModule(db,'u1',4,safe,address,null,new Date('2026-10-11T01:00:00Z'),original);const saved=await getActiveModule(db,'u1',4);assert.equal(saved?.startsAt,original.startsAt);assert.equal(saved?.expiresAt,original.expiresAt);await assert.rejects(saveActiveModule(db,'u1',4,safe,address,null,new Date(),{...original,expiresAt:original.expiresAt+86400}));}finally{sql.close();}});

test('recording new install-time prices preserves the matching module window across midnight', async () => {
  const { moduleRecordContext } = await import('./active-modules.ts');
  const current = { safe: '0x1111111111111111111111111111111111111111', module: '0x2222222222222222222222222222222222222222', mandateVersion: 4, verifiedAt: '2026-10-10T12:00:00Z', startsAt: 1791590400, expiresAt: 1791763200, outputs: null };
  const outputs = [{ token: '0x3333333333333333333333333333333333333333', fee: 500, tickSpacing: 10, minimumOutputRaw: '100' }];
  assert.deepEqual(moduleRecordContext(current, current.module.toUpperCase(), outputs), { outputs, window: { startsAt: current.startsAt, expiresAt: current.expiresAt } });
  assert.equal(moduleRecordContext(current, '0x4444444444444444444444444444444444444444', outputs).window, undefined);
  assert.equal(moduleRecordContext(current, current.module, [{ ...outputs[0], minimumOutputRaw: '0' }]).outputs, null);
});
