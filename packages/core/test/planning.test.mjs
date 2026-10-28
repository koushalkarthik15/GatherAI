import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleEvents } from '../../../apps/web/src/data/sampleEvents.ts';
import { planningMetadataSchema, previewAttendance, previewEventDate, shiftCalendarDate } from '../src/planning.ts';
const fresh=()=>structuredClone(sampleEvents[0]);
const metadata=()=>planningMetadataSchema.parse({});
test('legacy plans never infer per-attendee costs or relative deadlines',()=>{
 const plan=fresh(),before=structuredClone(plan);
 assert.deepEqual(previewAttendance(plan,metadata(),100).plan.budget,plan.budget);
 assert.deepEqual(previewEventDate(plan,metadata(),'2027-01-10','2026-10-26').plan.tasks,plan.tasks);
 assert.deepEqual(plan,before);
});
test('attendance scales only explicit unit costs and preserves manual fields and commitments',()=>{
 const plan=fresh();plan.guests=10;
 plan.budget[0].committed=false;plan.budget[0].actual=200;
 plan.tasks[0].notes='Keep organizer notes';
 const before=structuredClone(plan);
 const meta=metadata();meta.capacity=15;
 meta.budget=[{id:plan.budget[0].id,basis:'per_attendee',unitCost:125},
  {id:plan.budget[1].id,basis:'per_attendee',unitCost:3}];
 const result=previewAttendance(plan,meta,20);
 assert.equal(result.plan.budget[0].estimate,2500);
 assert.deepEqual(result.plan.budget.slice(1),plan.budget.slice(1));
 assert.deepEqual(result.plan.tasks,plan.tasks);
 assert.equal(result.baseRevision,plan.revision);
 assert.equal(result.plan.revision,plan.revision);
 assert.ok(result.warnings.some(w=>w.code==='CAPACITY_EXCEEDED'));
 assert.ok(result.warnings.some(w=>w.code==='PROTECTED_COST'));
 assert.deepEqual(plan,before);
});
test('attendance floor protects actuals and repeated previews do not compound rounding',()=>{
 const plan=fresh();plan.budget[0].committed=false;plan.budget[0].actual=250;
 const meta=metadata();meta.budget=[{id:plan.budget[0].id,basis:'per_attendee',unitCost:101}];
 const small=previewAttendance(plan,meta,1);
 assert.equal(small.plan.budget[0].estimate,250);
 assert.equal(small.plan.budget[0].actual,250);
 const larger=previewAttendance(small.plan,meta,7);
 assert.equal(larger.plan.budget[0].estimate,707);
});
test('invalid references, duplicate metadata, attendance and overflowing costs are rejected',()=>{
 const plan=fresh(),meta=metadata();
 for(const n of [0,-1,NaN,Infinity,1.5,100001])assert.throws(()=>previewAttendance(plan,meta,n));
 meta.budget=[{id:'foreign',basis:'fixed'}];assert.throws(()=>previewAttendance(plan,meta,1));
 meta.budget=[{id:plan.budget[0].id,basis:'fixed'},{id:plan.budget[0].id,basis:'manual'}];
 assert.throws(()=>previewAttendance(plan,meta,1));
 meta.budget=[{id:plan.budget[0].id,basis:'per_attendee',unitCost:1_000_000_000}];
 assert.throws(()=>previewAttendance(plan,meta,2));
});
test('budget infeasibility is visible and pending funding cannot hide it',()=>{
 const plan=fresh();plan.confirmed=1;plan.pending=1_000_000_000;
 const result=previewAttendance(plan,metadata(),plan.guests+1);
 assert.ok(result.conflicts.length);
 assert.equal(result.plan.confirmed,1);
 assert.equal(result.plan.pending,1_000_000_000);
});
test('calendar shifting handles leap day, year boundaries and daylight-saving dates',()=>{
 assert.equal(shiftCalendarDate('2028-02-28',1),'2028-02-29');
 assert.equal(shiftCalendarDate('2028-02-29',1),'2028-03-01');
 assert.equal(shiftCalendarDate('2027-12-31',1),'2028-01-01');
 assert.equal(shiftCalendarDate('2026-03-08',1),'2026-03-09');
 assert.equal(shiftCalendarDate('2026-11-01',-1),'2026-10-31');
 for(const date of ['2027-02-29','2026-13-01','2026-04-31','01-01-2026','1899-12-31'])
  assert.throws(()=>shiftCalendarDate(date,1));
 assert.throws(()=>shiftCalendarDate('2199-12-31',1));
});
test('date previews preserve completed/fixed tasks, IDs and unrelated data and flag bookings',()=>{
 const plan=fresh();plan.date='2028-02-28';
 plan.tasks[0].due='2028-02-27';plan.tasks[0].status='To do';
 plan.tasks[1].due='2028-02-26';plan.tasks[1].status='Done';
 plan.tasks[2].due='2028-03-03';plan.tasks[2].status='To do';
 const before=structuredClone(plan),meta=metadata();
 meta.tasks=[{id:plan.tasks[0].id,deadlineMode:'event_relative'},{id:plan.tasks[1].id,deadlineMode:'event_relative'}];
 const result=previewEventDate(plan,meta,'2028-03-01','2028-02-28');
 assert.equal(result.plan.tasks[0].due,'2028-02-29');
 assert.deepEqual(result.plan.tasks[1],plan.tasks[1]);
 assert.deepEqual(result.plan.tasks[2],plan.tasks[2]);
 assert.ok(result.warnings.some(w=>w.code==='AFTER_EVENT'&&w.entityId===plan.tasks[2].id));
 assert.deepEqual(result.plan.budget,plan.budget);
 assert.deepEqual(result.plan.agenda,plan.agenda);
 for(const resource of result.plan.resources){
  const old=plan.resources.find(r=>r.id===resource.id);
  assert.equal(resource.status,['Confirmed','Requested'].includes(old.status)?'Reconfirmation needed':old.status);
 }
 assert.deepEqual(plan,before);
});
test('past unfinished deadlines are flagged and no-op previews do not reconfirm bookings',()=>{
 const plan=fresh();plan.tasks[0].due='2026-01-01';plan.tasks[0].status='To do';
 assert.ok(previewEventDate(plan,metadata(),'2027-01-01','2026-10-26').warnings.some(w=>w.code==='PAST_DEADLINE'));
 assert.deepEqual(previewEventDate(plan,metadata(),plan.date,'2026-10-26').plan,plan);
 assert.deepEqual(previewAttendance(plan,metadata(),plan.guests).warnings,[]);
});
