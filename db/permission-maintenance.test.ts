import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { latestMaintenance, maintenanceById, recordMaintenanceHash, reserveMaintenance, settleMaintenance, unresolvedMaintenance } from './permission-maintenance.ts';
import type { RolesPolicy } from '../lib/roles-permission.ts';

const storedPolicy={account:'0x2222222222222222222222222222222222222222'} as unknown as RolesPolicy;

function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0035_permission_maintenance_attempts.sql',import.meta.url),'utf8'));
  const db={prepare(query:string){let values:(string|number|null)[]=[];const statement={
    bind(...args:(string|number|null)[]){values=args;return statement;},
    async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};},
    async first(){return sql.prepare(query).get(...values)??null;},
  };return statement;}} as unknown as D1Database;
  return {db,sql};
}

test('a prepared renewal survives reload, blocks duplicate signing, and verifies once settled',async()=>{
  const {db,sql}=fixture();
  try{
    const input={owner:'user-1',ownerAddress:'0x1111111111111111111111111111111111111111',
      safe:'0x2222222222222222222222222222222222222222',module:'0x3333333333333333333333333333333333333333',
      mandateVersion:4,kind:'renew' as const,transaction:{from:'0x1111111111111111111111111111111111111111',
        to:'0x2222222222222222222222222222222222222222',data:'0x1234',value:'0x0' as const},
      policy:storedPolicy,startsAt:1,expiresAt:2} satisfies Parameters<typeof reserveMaintenance>[1];
    const id=await reserveMaintenance(db,input);
    assert.ok(id);
    assert.equal((await unresolvedMaintenance(db,input.owner,input.safe))?.id,id);
    assert.equal(await reserveMaintenance(db,input),null);
    const hash=`0x${'a'.repeat(64)}`;
    assert.equal(await recordMaintenanceHash(db,input.owner,id!,hash),true);
    assert.equal(await recordMaintenanceHash(db,input.owner,id!,hash),false);
    assert.equal((await maintenanceById(db,input.owner,id!))?.state,'submitted');
    assert.equal((await latestMaintenance(db,input.owner,input.safe))?.hash,hash);
    assert.equal(await settleMaintenance(db,input.owner,id!,'confirmed'),true);
    assert.equal((await unresolvedMaintenance(db,input.owner,input.safe)),null);
    assert.equal((await latestMaintenance(db,input.owner,input.safe))?.state,'confirmed');
    assert.ok(await reserveMaintenance(db,input));
  }finally{sql.close();}
});

test('failed renewal cannot be claimed confirmed without a hash; reverted attempt unblocks',async()=>{
  const {db,sql}=fixture();
  try{
    const input={owner:'user-2',ownerAddress:'0x1111111111111111111111111111111111111111',
      safe:'0x2222222222222222222222222222222222222222',module:'0x3333333333333333333333333333333333333333',
      mandateVersion:4,kind:'renew' as const,transaction:{from:'0x1111111111111111111111111111111111111111',
        to:'0x2222222222222222222222222222222222222222',data:'0x1234',value:'0x0' as const},
      policy:storedPolicy,startsAt:1,expiresAt:2} satisfies Parameters<typeof reserveMaintenance>[1];
    const id=(await reserveMaintenance(db,input))!;
    assert.equal(await settleMaintenance(db,input.owner,id,'confirmed'),false);
    assert.equal((await maintenanceById(db,input.owner,id))?.state,'prepared');
    assert.equal(await recordMaintenanceHash(db,input.owner,id,'bad'),false);
    assert.equal(await recordMaintenanceHash(db,input.owner,id,`0x${'b'.repeat(64)}`),true);
    assert.equal(await settleMaintenance(db,input.owner,id,'reverted'),true);
    assert.equal((await unresolvedMaintenance(db,input.owner,input.safe)),null);
  }finally{sql.close();}
});
