import {validateGoal,type SavedGoal} from '../lib/goal-plan.ts';
export async function loadGoal(db:D1Database,owner:string):Promise<SavedGoal|null>{
 const row=await db.prepare('SELECT revision,plan_json,updated_at FROM goal_plans WHERE owner_ref=?').bind(owner).first<{revision:number;plan_json:string;updated_at:string}>();
 return row?{revision:row.revision,plan:validateGoal(JSON.parse(row.plan_json)),updatedAt:row.updated_at}:null;
}
export async function saveGoal(db:D1Database,owner:string,revision:number,value:unknown,now=Date.now()){
 const plan=validateGoal(value),previous=await loadGoal(db,owner);
 if((previous?.revision??0)!==revision)throw Error('GOAL_CONFLICT');
 plan.startedAt=previous?.plan.startedAt??new Date(now).toISOString();
 const updatedAt=new Date(now).toISOString();
 const result=await db.prepare(`INSERT INTO goal_plans(owner_ref,revision,plan_json,updated_at) SELECT ?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM goal_plans WHERE owner_ref=? AND revision=?)
 ON CONFLICT(owner_ref) DO UPDATE SET revision=excluded.revision,plan_json=excluded.plan_json,updated_at=excluded.updated_at WHERE goal_plans.revision=?`).bind(owner,revision+1,JSON.stringify(plan),updatedAt,revision,owner,revision,revision).run();
 if(result.meta.changes!==1)throw Error('GOAL_CONFLICT');
 return {revision:revision+1,plan,updatedAt};
}
