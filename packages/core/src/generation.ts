import { z } from 'zod';
import { cloudPlanSchema } from './cloud.ts';
import { totals, type EventPlan } from './index.ts';
const text=z.string().trim().min(1).max(200);
export const generatedPlanSchema=z.object({
 summary:text,
 assumptions:z.array(text).max(8),
 groups:z.array(z.object({name:text}).strict()).min(1).max(5),
 tasks:z.array(z.object({
  group:z.number().int().min(0).max(4),title:text,notes:z.string().max(1000),
  due:z.string().max(10),priority:z.enum(['Low','Medium','High']),
 }).strict()).min(1).max(20),
 budget:z.array(z.object({name:text,category:text,estimate:z.number().int().min(0).max(1_000_000_000)}).strict()).max(10),
 resources:z.array(z.object({name:text,source:z.string().max(300)}).strict()).max(10),
 agenda:z.array(z.object({time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),title:text}).strict()).max(10),
}).strict();
export type GeneratedPlan=z.infer<typeof generatedPlanSchema>;
export const proposalSchema=z.object({
 id:z.uuid(),eventId:z.uuid(),baseRevision:z.number().int().nonnegative(),
 status:z.enum(['running','ready','failed','applied','discarded','rolled_back']),
 plan:cloudPlanSchema.nullable(),summary:z.string(),assumptions:z.array(z.string()),
 provider:z.string(),model:z.string(),attempts:z.number().int().min(0).max(2),
 appliedRevision:z.number().int().nullable(),
}).strict();
export type SavedProposal=z.infer<typeof proposalSchema>;
export function isEmptyPlan(plan:EventPlan){
 return !plan.tasks.length&&!plan.budget.length&&!plan.resources.length&&!plan.agenda.length;
}
/** Server creates IDs and all actual/status/commitment fields; model controls suggestions only. */
export function materializeGeneratedPlan(source:EventPlan,raw:unknown,newId:()=>string){
 const plan=cloudPlanSchema.parse(source),output=generatedPlanSchema.parse(raw);
 const key=(value:string)=>value.trim().toLocaleLowerCase('en-IN');
 const uniqueByName=<T,>(items:T[],existing:string[],name:(value:T)=>string)=>{
  const seen=new Set(existing.map(key));
  return items.filter(item=>{const label=key(name(item));if(seen.has(label))return false;seen.add(label);return true;});
 };
 const groups=[...plan.groups];
 const groupReferences=output.groups.map(group=>{
  const existing=groups.find(item=>item.name.toLocaleLowerCase('en-IN')===group.name.toLocaleLowerCase('en-IN'));
  if(existing)return existing;
  const added={id:newId(),name:group.name};groups.push(added);return added;
 });
 const tasks=uniqueByName(output.tasks,plan.tasks.map(task=>task.title),task=>task.title).map(task=>{
  const group=groupReferences[task.group];
  if(!group||task.due&&task.due>plan.date)throw new Error('Invalid generated task group or deadline.');
  return {id:newId(),groupId:group.id,title:task.title,notes:task.notes,due:task.due,
   owner:'',priority:task.priority,status:'To do' as const};
 });
 const candidate=cloudPlanSchema.parse({...plan,groups,tasks:[...plan.tasks,...tasks],
  budget:[...plan.budget,...uniqueByName(output.budget,plan.budget.map(item=>item.name),item=>item.name).map(item=>({...item,id:newId(),actual:0,committed:false}))],
  resources:[...plan.resources,...uniqueByName(output.resources,plan.resources.map(item=>item.name),item=>item.name).map(item=>({...item,id:newId(),status:'Needed' as const}))],
  agenda:[...plan.agenda,...uniqueByName(output.agenda,plan.agenda.map(item=>item.title),item=>item.title).map(item=>({...item,id:newId(),owner:''}))],
 });
 if(totals(candidate).exposure>Math.max(totals(plan).exposure,totals(plan).ceiling))throw new Error('Generated budget exceeds available funds.');
 return {plan:candidate,summary:output.summary,assumptions:output.assumptions};
}

