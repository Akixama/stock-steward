import {DEFAULT_GUARD,freshGuard,validGuardSettings,type GuardSettings,type GuardState} from '../lib/panic-guard.ts';
export async function loadGuard(db:D1Database,owner:string,grantId?:string):Promise<{settings:GuardSettings;state:GuardState|null}>{
 const row=await db.prepare('SELECT settings_json,state_json FROM panic_guards WHERE owner_ref=?').bind(owner).first<{settings_json:string;state_json:string|null}>();
 let settings=DEFAULT_GUARD;try{if(row)settings=validGuardSettings(JSON.parse(row.settings_json));}catch{settings=DEFAULT_GUARD;}
 let state:GuardState|null=null;try{state=row?.state_json?JSON.parse(row.state_json) as GuardState:null;}catch{state=null;}
 // A new permission starts with a fresh high and starting value.
 if(grantId&&(!state||state.grantId!==grantId))state=freshGuard(grantId);
 return {settings,state};
}
export async function saveGuardSettings(db:D1Database,owner:string,value:unknown){
 const settings=validGuardSettings(value);
 await db.prepare('INSERT INTO panic_guards(owner_ref,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(owner_ref) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(owner,JSON.stringify(settings),new Date().toISOString()).run();
 return settings;
}
export async function saveGuardState(db:D1Database,owner:string,state:GuardState){
 await db.prepare('INSERT INTO panic_guards(owner_ref,settings_json,state_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_ref) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').bind(owner,JSON.stringify(DEFAULT_GUARD),JSON.stringify(state),new Date().toISOString()).run();
}
