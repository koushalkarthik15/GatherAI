import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProposal, moveTask, proposeDemoBudget, totals } from '../src/rules.ts';
import { sampleEvents } from '../../../apps/web/src/data/sampleEvents.ts';

const fresh = () => structuredClone(sampleEvents[0]);
test('pending funds never increase the spending ceiling', () => {
 const event = fresh(); event.pending = 99_000_000;
 assert.equal(totals(event).ceiling, 2_000_000);
 event.limit = 1_500_000; assert.equal(totals(event).remaining, -500_000);
});
test('budget proposal protects commitments, actuals, and all checklist data', () => {
 const event = fresh();
 event.budget[2].actual = 20_000;
 event.tasks[2].notes = 'Manual note to preserve';
 const before = structuredClone(event);
 const proposal = proposeDemoBudget(event, 1_500_000);
 assert.equal(proposal.conflict, null);
 assert.equal(proposal.budget[0].estimate, event.budget[0].estimate);
 assert.equal(proposal.budget[1].estimate, event.budget[1].estimate);
 for (const item of proposal.budget) assert.ok(item.estimate >= item.actual);
 const next = applyProposal(event, proposal);
 assert.deepEqual(next.tasks, before.tasks);
 assert.deepEqual(next.resources, before.resources);
 assert.equal(totals(next).estimate, 1_500_000);
 assert.deepEqual(event, before, 'proposal creation and apply must not mutate source');
});
test('impossible budget is blocked rather than cutting committed amounts', () => {
 const event = fresh(), proposal = proposeDemoBudget(event, 900_000);
 assert.ok(proposal.conflict);
 assert.throws(() => applyProposal(event, proposal));
 assert.equal(proposal.budget[0].estimate, 400_000);
 assert.equal(proposal.budget[1].estimate, 600_000);
});
test('stale and cross-event proposals cannot apply', () => {
 const event = fresh(), proposal = proposeDemoBudget(event, 1_500_000);
 assert.throws(() => applyProposal({...event, revision: 1}, proposal), /changed/);
 assert.throws(() => applyProposal({...event, id: 'another'}, proposal), /changed/);
});
test('integer rounding fits the ceiling exactly at small remainders', () => {
 for (const amount of [1_000_001, 1_234_567, 1_999_999]) {
  const event = fresh(), proposal = proposeDemoBudget(event, amount);
  assert.equal(proposal.budget.reduce((sum,b)=>sum+b.estimate,0), amount);
  assert.ok(proposal.budget.every(b=>Number.isSafeInteger(b.estimate)));
 }
});
test('higher funding never silently increases allocations', () => {
 const event = fresh(), proposal = proposeDemoBudget(event, 3_000_000);
 assert.deepEqual(proposal.budget,event.budget);
});
test('actual spending above an estimate remains protected', () => {
 const event = fresh(); event.budget[2].actual = 350_000;
 const proposal = proposeDemoBudget(event, 1_800_000);
 assert.equal(proposal.conflict,null);
 assert.ok(proposal.budget[2].estimate >= 350_000);
});
test('invalid money values are rejected', () => {
 for (const amount of [-1, NaN, Infinity, 1.1, 1_000_000_001])
  assert.throws(()=>proposeDemoBudget(fresh(),amount));
});
test('task order changes within the group without mutating or losing details', () => {
 const event = fresh(), before = structuredClone(event);
 const next = moveTask(event,event.tasks[0].id,1);
 assert.equal(next.tasks[1].id,event.tasks[0].id);
 assert.deepEqual(event,before);
 assert.deepEqual(next.tasks[1],before.tasks[0]);
 const boundary = moveTask(event,event.tasks[0].id,-1);
 assert.deepEqual(boundary,event);
});
test('reordering one event never changes another sample', () => {
 const other = structuredClone(sampleEvents[1]);
 moveTask(fresh(),sampleEvents[0].tasks[0].id,1);
 assert.deepEqual(sampleEvents[1],other);
});

test('remaining funds account for actual spending above an estimate', () => {
 const event = fresh(); event.budget[2].actual = 350_000;
 assert.equal(totals(event).exposure, 2_050_000);
 assert.equal(totals(event).remaining, -50_000);
});
