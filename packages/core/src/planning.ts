import { z } from 'zod';
import { eventSchema, type EventPlan } from './index.ts';
import { totals } from './rules.ts';

const MAX_MONEY=1_000_000_000;

const guests=z.number().int().min(1).max(100000);

import { planningMetadataSchema, type PlanningMetadata } from './planningMetadata.ts';
export { planningMetadataSchema, type PlanningMetadata } from './planningMetadata.ts';
export type PlanningWarning={
 code:'CAPACITY_EXCEEDED'|'RECONFIRM_QUANTITIES'|'RECONFIRM_BOOKING'|'PROTECTED_COST'|'PAST_DEADLINE'|'AFTER_EVENT';
 entityId?:string;
 message:string;
};
export type PlanningPreview={
 eventId:string;baseRevision:number;plan:EventPlan;
 warnings:PlanningWarning[];conflicts:string[];
};

function calendarDate(value:string) {
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))throw new Error('Use a valid calendar date.');
 const [year,month,day]=value.split('-').map(Number);
 if(year<1900||year>2199||month<1||month>12||day<1||day>monthDays(year)[month-1])
  throw new Error('Use a calendar date between 1900 and 2199.');
 return {year,month,day};
}
function leap(year:number){return year%4===0&&(year%100!==0||year%400===0);}
function monthDays(year:number){return [31,leap(year)?29:28,31,30,31,30,31,31,30,31,30,31];}
function ordinal(value:string){
 const {year,month,day}=calendarDate(value),prior=year-1;
 return 365*prior+Math.floor(prior/4)-Math.floor(prior/100)+Math.floor(prior/400)
  +monthDays(year).slice(0,month-1).reduce((sum,n)=>sum+n,0)+day;
}
/** Calendar components, independent of local timezone and DST elapsed hours. */
export function shiftCalendarDate(value:string,days:number){
 const {year,month,day}=calendarDate(value);
 if(!Number.isSafeInteger(days)||Math.abs(days)>110000)throw new Error('Invalid calendar shift.');
 const date=new Date(0);
 date.setUTCFullYear(year,month-1,day);
 date.setUTCDate(date.getUTCDate()+days);
 const result=date.toISOString().slice(0,10);
 calendarDate(result);
 return result;
}
function context(plan:EventPlan,metadata:PlanningMetadata){
 const parsed=eventSchema.parse(plan),meta=planningMetadataSchema.parse(metadata);
 calendarDate(parsed.date);
 const allIds=new Set<string>();
 for(const list of [parsed.groups,parsed.tasks,parsed.budget,parsed.resources,parsed.agenda]){
  for(const item of list){
   if(allIds.has(item.id))throw new Error('Duplicate entity ID.');
   allIds.add(item.id);
  }
 }
 const groupIds=new Set(parsed.groups.map(group=>group.id));
 for(const task of parsed.tasks){
  if(!groupIds.has(task.groupId))throw new Error('Task group does not belong to this event.');
  if(task.due)calendarDate(task.due);
 }
 for(const [entries,items] of [[meta.budget,parsed.budget],[meta.tasks,parsed.tasks]] as const){
  const seen=new Set<string>(),ids=new Set(items.map(item=>item.id));
  for(const entry of entries){
   if(seen.has(entry.id)||!ids.has(entry.id))throw new Error('Invalid or duplicate planning reference.');
   seen.add(entry.id);
  }
 }
 return {plan:parsed,metadata:meta};
}
function preview(plan:EventPlan,warnings:PlanningWarning[]):PlanningPreview {
 const result=totals(plan);
 return {eventId:plan.id,baseRevision:plan.revision,plan,warnings,
  conflicts:result.remaining<0?['Planned exposure exceeds the confirmed spending ceiling by '+(-result.remaining)+' minor units.']:[]};
}

/** Pure attendance scenario. It neither increments a revision nor saves/applies a plan. */
export function previewAttendance(source:EventPlan,metadata:PlanningMetadata,nextGuests:number):PlanningPreview{
 const {plan,metadata:meta}=context(source,metadata);
 guests.parse(nextGuests);
 if(nextGuests===plan.guests)return preview(plan,[]);
 const warnings:PlanningWarning[]=[];
 const costs=new Map(meta.budget.map(item=>[item.id,item]));
 const budget=plan.budget.map(item=>{
  const cost=costs.get(item.id);
  if(cost?.basis!=='per_attendee')return item;
  const scaled=cost.unitCost*nextGuests;
  if(!Number.isSafeInteger(scaled)||scaled>MAX_MONEY)throw new Error('Scaled cost exceeds the supported amount.');
  if(item.committed){
   warnings.push({code:'PROTECTED_COST',entityId:item.id,message:'Committed estimate and recorded spending are preserved; confirm supplier quantities manually.'});
   return item;
  }
  const estimate=Math.max(item.actual,scaled);
  if(item.actual>scaled)warnings.push({code:'PROTECTED_COST',entityId:item.id,message:'Recorded spending sets the minimum estimate.'});
  return {...item,estimate};
 });
 if(meta.capacity!==undefined&&nextGuests>meta.capacity)
  warnings.push({code:'CAPACITY_EXCEEDED',message:'Expected attendance exceeds the stated venue capacity.'});
 warnings.push({code:'RECONFIRM_QUANTITIES',message:'Reconfirm supplier quantities and staffing for the new attendance.'});
 return preview({...plan,guests:nextGuests,budget},warnings);
}

/** Only unfinished, explicitly relative deadlines move. Today is an explicit local date. */
export function previewEventDate(source:EventPlan,metadata:PlanningMetadata,nextDate:string,today:string):PlanningPreview{
 const {plan,metadata:meta}=context(source,metadata);
 calendarDate(nextDate);calendarDate(today);
 if(nextDate===plan.date)return preview(plan,[]);
 const delta=ordinal(nextDate)-ordinal(plan.date);
 const modes=new Map(meta.tasks.map(task=>[task.id,task.deadlineMode]));
 const warnings:PlanningWarning[]=[];
 const tasks=plan.tasks.map(task=>{
  if(task.status==='Done')return task;
  const due=task.due&&modes.get(task.id)==='event_relative'?shiftCalendarDate(task.due,delta):task.due;
  if(due&&due<today)warnings.push({code:'PAST_DEADLINE',entityId:task.id,message:'This unfinished deadline is in the past.'});
  if(due&&due>nextDate)warnings.push({code:'AFTER_EVENT',entityId:task.id,message:'This preparation deadline falls after the event.'});
  return {...task,due};
 });
 const resources=plan.resources.map(resource=>{
  if(resource.status!=='Confirmed'&&resource.status!=='Requested')return resource;
  warnings.push({code:'RECONFIRM_BOOKING',entityId:resource.id,message:'Reconfirm availability for the new event date.'});
  return {...resource,status:'Reconfirmation needed' as const};
 });
 return preview({...plan,date:nextDate,tasks,resources},warnings);
}
