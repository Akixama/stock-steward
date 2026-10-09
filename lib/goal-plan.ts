export type GoalPlan={name:string;targetCents:number;currentCents:number;monthlyCents:number;months:number;comfort:'cautious'|'balanced'|'comfortable';startedAt:string};
export type SavedGoal={revision:number;plan:GoalPlan;updatedAt:string};
export function validateGoal(value:unknown):GoalPlan{
 if(!value||typeof value!=='object')throw Error('Enter your goal details.');
 const p=value as GoalPlan;
 if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>80)throw Error('Give your goal a name, up to 80 characters.');
 if(![p.targetCents,p.currentCents,p.monthlyCents].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000000)||p.targetCents===0)throw Error('Use valid amounts, with at most two decimal places.');
 if(!Number.isInteger(p.months)||p.months<1||p.months>600)throw Error('Choose a timeframe from 1 to 600 months.');
 if(!['cautious','balanced','comfortable'].includes(p.comfort))throw Error('Choose your comfort with price changes.');
 if(typeof p.startedAt!=='string'||!Number.isFinite(Date.parse(p.startedAt)))throw Error('Invalid plan start date.');
 return {...p,name:p.name.trim()};
}
export function goalProgress(plan:GoalPlan,now=Date.now()){
 const start=new Date(plan.startedAt),at=new Date(now);
 const calendarMonths=(at.getUTCFullYear()-start.getUTCFullYear())*12+at.getUTCMonth()-start.getUTCMonth();
 const anniversaryDay=Math.min(start.getUTCDate(),new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth()+1,0)).getUTCDate());
 const anniversary=Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),anniversaryDay,start.getUTCHours(),start.getUTCMinutes(),start.getUTCSeconds(),start.getUTCMilliseconds());
 const elapsed=Math.max(0,calendarMonths-(now<anniversary?1:0));
 const remainingMonths=Math.max(0,plan.months-elapsed),gapCents=Math.max(0,plan.targetCents-plan.currentCents);
 const projectedCents=plan.currentCents+plan.monthlyCents*remainingMonths;
 return {remainingMonths,gapCents,projectedCents,shortfallCents:Math.max(0,plan.targetCents-projectedCents),requiredMonthlyCents:remainingMonths?Math.ceil(gapCents/remainingMonths):null,percent:Math.min(100,Math.floor(plan.currentCents/plan.targetCents*100))};
}


export function goalGuidance(plan:GoalPlan,progress:ReturnType<typeof goalProgress>):{title:string;points:{text:string;detail:string}[]}{
 const usd=(c:number)=>'$'+(c/100).toFixed(2);
 const reached=progress.percent>=100;
 const expired=progress.remainingMonths===0&&!reached;
 const points:{text:string;detail:string}[]=[];
 if(reached)points.push({text:'Your recorded savings meet this target.',detail:'Keep the plan updated as your savings change, or set a new goal when you are ready.'});
 else if(expired)points.push({text:'The timeframe has ended with '+usd(progress.gapCents)+' still to go.',detail:'Extend the timeframe or update your recorded savings to see a new projection.'});
 else{
  if(progress.shortfallCents>0)points.push({text:'Contributions alone leave a '+usd(progress.shortfallCents)+' gap.',detail:progress.requiredMonthlyCents!==null?'About '+usd(progress.requiredMonthlyCents)+' per month would cover the target in '+progress.remainingMonths+' months, or you can extend the timeframe.':'Extend your timeframe to see what monthly contribution would cover it.'});
  else points.push({text:'Your planned contributions cover this target.',detail:'Nothing extra is needed; keep recording savings as they arrive.'});
  if(plan.comfort==='cautious'){
   points.push({text:'Keep the pace predictable.',detail:'Steady scheduled buys and price-ceiling rules in Practice match a cautious approach; nothing here changes your saved trade limits.'});
   points.push({text:'Protect the buffer first.',detail:'Practice rules can keep a cash reserve untouched so a shortfall never forces a sale at a bad time.'});
  }else if(plan.comfort==='balanced'){
   points.push({text:'Spread the entries out.',detail:'Dollar-cost style scheduled buys and cautious accumulation rules in Practice average out ups and downs without timing the market.'});
   points.push({text:'Let rules pause in sharp swings.',detail:'Accumulation rules wait when prices move too quickly, which suits a moderate risk tolerance.'});
  }else{
   points.push({text:'Volatility can be planned for.',detail:'Price-band and target-allocation rules in Practice turn larger swings into reviewed, deliberate trades within your limits.'});
   points.push({text:'Rebalancing keeps a mix honest.',detail:'Portfolio rules return holdings toward your chosen targets instead of letting one position dominate.'});
  }
 }
 return {title:plan.comfort==='cautious'?'Guidance for a cautious saver.':plan.comfort==='balanced'?'Guidance for a balanced saver.':'Guidance for a saver comfortable with ups and downs.',points};
}
