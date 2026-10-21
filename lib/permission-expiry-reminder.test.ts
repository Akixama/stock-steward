import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {queuePermissionExpiryReminders,reminderDue} from './permission-expiry-reminder.ts';
import {RENEW_NOTICE_SECONDS} from './permission-window.ts';

test('reminder is due only during the bounded pre-expiry window',()=>{
  const now=1_000_000;
  assert.equal(reminderDue(now+RENEW_NOTICE_SECONDS+1,now),false);
  assert.equal(reminderDue(now+RENEW_NOTICE_SECONDS,now),true);
  assert.equal(reminderDue(now+1,now),true);
  assert.equal(reminderDue(now,now),false);
});

test('queues one reminder for the current permission and skips old or revoked permissions',async()=>{
  const sql=new DatabaseSync(':memory:');
  try{
    sql.exec('CREATE TABLE mandates(owner_ref TEXT,version INTEGER)');
    sql.exec('CREATE TABLE active_modules(owner_ref TEXT,mandate_version INTEGER,safe TEXT,expires_at INTEGER,verified_at TEXT)');
    sql.exec('CREATE TABLE push_subscriptions(id TEXT,owner_ref TEXT,endpoint TEXT,p256dh TEXT,auth TEXT)');
    sql.exec('CREATE TABLE permission_maintenance_attempts(owner_ref TEXT,safe TEXT,kind TEXT,state TEXT,updated_at TEXT)');
    sql.exec(readFileSync(new URL('../drizzle/0037_permission_expiry_reminders.sql',import.meta.url),'utf8'));
    const now=1_000_000,expiry=now+RENEW_NOTICE_SECONDS;
    sql.prepare('INSERT INTO mandates VALUES(?,?)').run('owner',1);
    sql.prepare('INSERT INTO mandates VALUES(?,?)').run('owner',2);
    sql.prepare('INSERT INTO active_modules VALUES(?,?,?,?,?)').run('owner',1,'old',expiry,'2026-10-21T00:00:00Z');
    sql.prepare('INSERT INTO active_modules VALUES(?,?,?,?,?)').run('owner',2,'current',expiry,'2026-10-21T00:00:00Z');
    sql.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?)').run('device','owner','https://example.test','p','a');
    const db={prepare(query:string){let args:unknown[]=[];const statement={bind(...values:unknown[]){args=values;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};}};return statement;}} as unknown as D1Database;
    await queuePermissionExpiryReminders(db,now);
    await queuePermissionExpiryReminders(db,now);
    assert.deepEqual(sql.prepare('SELECT safe FROM permission_expiry_deliveries').all().map(row=>row.safe),['current']);
    sql.prepare('INSERT INTO permission_maintenance_attempts VALUES(?,?,?,?,?)').run('owner','current','revoke','confirmed','2026-10-21T01:00:00Z');
    sql.prepare('DELETE FROM permission_expiry_deliveries').run();
    await queuePermissionExpiryReminders(db,now);
    assert.equal(sql.prepare('SELECT COUNT(*) count FROM permission_expiry_deliveries').get()?.count,0);
  }finally{sql.close();}
});
