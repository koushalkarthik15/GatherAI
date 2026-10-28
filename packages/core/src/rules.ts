import type { EventPlan, BudgetItem } from './index.ts';
export function totals(event: EventPlan) {
 const estimate = event.budget.reduce((sum, item) => sum + item.estimate, 0);
 const actual = event.budget.reduce((sum, item) => sum + item.actual, 0);
 const exposure = event.budget.reduce((sum, item) => sum + Math.max(item.estimate, item.actual), 0);
 const ceiling = Math.min(event.confirmed, event.limit);
 return { estimate, actual, exposure, ceiling, remaining: ceiling - exposure };
}
/** Facts from recorded data only; absence of a record never implies readiness. */
export function feasibilitySummary(event: EventPlan) {
 const money=totals(event);
 return {
  ...money,
  confirmed:event.confirmed,
  pending:event.pending,
  budgetItems:event.budget.length,
  resourcesRecorded:event.resources.length,
  resourcesConfirmed:event.resources.filter(item=>item.status==='Confirmed').length,
  resourcesOutstanding:event.resources.filter(item=>item.status!=='Confirmed').length,
  tasksRecorded:event.tasks.length,
  tasksBlocked:event.tasks.filter(item=>item.status==='Blocked').length,
 };
}
/** Read-only scenario; recorded costs and pending funds are never changed. */
export function previewFunding(event: EventPlan, confirmed: number, limit: number) {
 for(const value of [confirmed,limit]) {
  if(!Number.isSafeInteger(value)||value<0||value>1_000_000_000)throw new Error('Enter a valid nonnegative amount.');
 }
 const current=totals(event);
 const ceiling=Math.min(confirmed,limit);
 const protectedCost=event.budget.reduce((sum,item)=>sum+(item.committed?Math.max(item.estimate,item.actual):item.actual),0);
 return {current,confirmed,limit,ceiling,exposure:current.exposure,remaining:ceiling-current.exposure,protectedCost};
}
export const formatMoney = (minor: number) => new Intl.NumberFormat('en-IN', {
 style: 'currency', currency: 'INR', maximumFractionDigits: minor % 100 ? 2 : 0,
}).format(minor / 100);
export const formatDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('en-IN', {
 day: 'numeric', month: 'short', year: 'numeric',
});

export interface Proposal {
 eventId: string; baseRevision: number; confirmed: number; budget: BudgetItem[];
 conflict: string | null; reason: string;
}
/** Demo-only proportional scenario. It models arithmetic, not vendor viability or AI reasoning. */
export function proposeDemoBudget(event: EventPlan, confirmed: number): Proposal {
 if (!Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > 1_000_000_000) throw new Error('Invalid money amount.');
 const ceiling = Math.min(confirmed, event.limit);
 const protectedCost = event.budget.reduce((sum, item) => sum + (item.committed
  ? Math.max(item.estimate, item.actual) : item.actual), 0);
 const floors = event.budget.map(item => item.committed ? Math.max(item.estimate, item.actual) : item.actual);
 const adjustable = event.budget.map((item, i) => Math.max(0, item.estimate - floors[i]));
 const totalAdjustable = adjustable.reduce((a, b) => a + b, 0);
 let remaining = Math.min(totalAdjustable, Math.max(0, ceiling - protectedCost));
 const initialAvailable = remaining;
 const allocations = adjustable.map(value => totalAdjustable ? Math.floor(value * initialAvailable / totalAdjustable) : 0);
 remaining -= allocations.reduce((a, b) => a + b, 0);
 // Distribute rounding remainders without exceeding any item's original discretionary amount.
 for (let i = 0; remaining > 0 && i < allocations.length; i++) {
  if (allocations[i] < adjustable[i]) { allocations[i]++; remaining--; }
 }
 return { eventId: event.id, baseRevision: event.revision, confirmed,
  budget: event.budget.map((item, i) => ({ ...item, estimate: floors[i] + allocations[i] })),
  conflict: protectedCost > ceiling ? 'Committed costs and actual spending exceed this ceiling by ' + formatMoney(protectedCost - ceiling) + '. Increase funding or explicitly revisit a commitment.' : null,
  reason: 'Illustrative proportional cuts to flexible estimates. Commitments and actual spending are protected. Confirm the reduced estimates are practical before applying.',
 };
}
export function applyProposal(event: EventPlan, proposal: Proposal): EventPlan {
 if (event.id !== proposal.eventId || event.revision !== proposal.baseRevision) throw new Error('This plan changed. Create a fresh preview.');
 if (proposal.conflict) throw new Error(proposal.conflict);
 return { ...event, confirmed: proposal.confirmed, budget: proposal.budget, revision: event.revision + 1 };
}
export function moveTask(event: EventPlan, id: string, direction: -1 | 1): EventPlan {
 const task = event.tasks.find(t => t.id === id);
 if (!task) return event;
 const peers = event.tasks.filter(t => t.groupId === task.groupId);
 const target = peers[peers.findIndex(t => t.id === id) + direction];
 if (!target) return event;
 const tasks = [...event.tasks];
 const from = tasks.findIndex(t => t.id === id), to = tasks.findIndex(t => t.id === target.id);
 [tasks[from], tasks[to]] = [tasks[to], tasks[from]];
 return { ...event, tasks };
}

/** Removing a group never deletes its tasks; occupied groups require a valid destination. */
export function removeTaskGroup(event:EventPlan,groupId:string,destinationId?:string):EventPlan {
 if(!event.groups.some(group=>group.id===groupId))throw new Error('Group not found.');
 const affected=event.tasks.some(task=>task.groupId===groupId);
 if(affected&&(!destinationId||destinationId===groupId||!event.groups.some(group=>group.id===destinationId)))
  throw new Error('Choose another group for these tasks.');
 return {...event,groups:event.groups.filter(group=>group.id!==groupId),
  tasks:event.tasks.map(task=>task.groupId===groupId?{...task,groupId:destinationId!}:task)};
}
/** Validate a single prerequisite per task, including indirect cycles. */
export function validateTaskDependencies(tasks:EventPlan['tasks']):void {
 const byId=new Map(tasks.map(task=>[task.id,task]));
 for(const task of tasks) {
  const seen=new Set<string>([task.id]);
  let next=task.dependsOn;
  while(next) {
   if(seen.has(next))throw new Error('Dependency cycle.');
   const target=byId.get(next);
   if(!target)throw new Error('Dependency not found.');
   seen.add(next);next=target.dependsOn;
  }
 }
}