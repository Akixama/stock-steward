import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { getActiveModule, saveActiveModule } from "./active-modules.ts";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE active_modules(owner_ref TEXT NOT NULL,mandate_version INTEGER NOT NULL,safe TEXT NOT NULL,module TEXT NOT NULL,verified_at TEXT NOT NULL,PRIMARY KEY(owner_ref,mandate_version));");
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
