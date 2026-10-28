import { z } from 'zod';
import { eventSchema, eventBriefSchema, validateTaskDependencies } from './index.ts';
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
 const date = new Date(value + 'T12:00:00Z');
 return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, 'Use a valid calendar date.');
export const createEventInput = z.object({
 name: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(2000),
 kind: z.enum(['Club celebration','Workshop & technical talk','Community gathering']),
 date: localDate, location: z.string().trim().min(1).max(200),
 brief:eventBriefSchema.optional(),
 guests: z.number().int().min(1).max(100000),
 confirmed: z.number().int().min(0).max(1_000_000_000),
 limit: z.number().int().min(0).max(1_000_000_000),
}).strict();
export type CreateEventInput = z.infer<typeof createEventInput>;
export const cloudPlanSchema = eventSchema.extend({
 id:z.uuid(), name:z.string().trim().min(1).max(160), description:z.string().max(2000),
 kind:z.string().max(100), date:localDate, location:z.string().max(200),
 guests:z.number().int().min(1).max(100000),
 groups:eventSchema.shape.groups.max(50),
 tasks:eventSchema.shape.tasks.max(500),
 budget:eventSchema.shape.budget.max(100),
 resources:eventSchema.shape.resources.max(100),
 agenda:eventSchema.shape.agenda.max(100),
}).strict().superRefine((plan,ctx)=>{
 const seen=new Set<string>();
 for(const list of [plan.groups,plan.tasks,plan.budget,plan.resources,plan.agenda]){
  for(const item of list){
   if(!z.uuid().safeParse(item.id).success || seen.has(item.id))ctx.addIssue({code:'custom',message:'Entity IDs must be unique UUIDs.'});
   seen.add(item.id);
   if(Object.values(item).some(value=>typeof value==='string' && value.length>2000))ctx.addIssue({code:'custom',message:'Field is too long.'});
  }
 }
 try{validateTaskDependencies(plan.tasks);}catch{ctx.addIssue({code:'custom',message:'Task dependencies must exist in the same event and cannot form a cycle.'});}
 if(plan.planning){
  for(const [entries,items] of [[plan.planning.budget,plan.budget],[plan.planning.tasks,plan.tasks]] as const){
   const ids=new Set(items.map(item=>item.id));const seen=new Set<string>();
   for(const entry of entries){if(!ids.has(entry.id)||seen.has(entry.id))ctx.addIssue({code:'custom',message:'Invalid planning metadata reference.'});seen.add(entry.id);}
  }
 }
 const budgets=new Set(plan.budget.map(item=>item.id));
 for(const resource of plan.resources){
  if(resource.details?.budgetId&&!budgets.has(resource.details.budgetId))ctx.addIssue({code:'custom',message:'Resource budget item does not belong to this event.'});
 }
 const groups=new Set(plan.groups.map(g=>g.id));
 for(const task of plan.tasks){
  if(!groups.has(task.groupId))ctx.addIssue({code:'custom',message:'Task group does not belong to this event.'});
  if(task.due && !localDate.safeParse(task.due).success)ctx.addIssue({code:'custom',message:'Invalid task deadline.'});
 }
 for(const activity of plan.agenda){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time))ctx.addIssue({code:'custom',message:'Invalid activity time.'});
 }
});
export const saveEventInput=z.object({
 operationId:z.uuid(), expectedRevision:z.number().int().nonnegative(),
 plan:cloudPlanSchema,
}).strict();
