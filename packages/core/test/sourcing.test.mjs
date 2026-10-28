import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleEvents } from '../../../apps/web/src/data/sampleEvents.ts';
import { applyResourceQuote, safeWebUrl, resourceEnquiry, chooseResource } from '../src/sourcing.ts';
test('quotes preserve actuals and stable links without mutating the original plan',()=>{
 const plan=structuredClone(sampleEvents[0]);
 plan.resources[0].details={kind:'venue',quote:1000};
 const original=structuredClone(plan);
 const next=applyResourceQuote(plan,plan.resources[0].id,()=> 'new-budget');
 assert.deepEqual(plan,original);
 assert.equal(next.budget.at(-1).actual,0);
 const repeated=applyResourceQuote(next,plan.resources[0].id,()=>{throw new Error('Must reuse link');});
 assert.equal(repeated.budget.length,next.budget.length);
 repeated.budget.at(-1).actual=2000;
 assert.equal(applyResourceQuote(repeated,plan.resources[0].id,()=> '').budget.at(-1).estimate,2000);
 repeated.budget.at(-1).committed=true;
 assert.throws(()=>applyResourceQuote(repeated,plan.resources[0].id,()=> ''));
});
test('unsafe source links are rejected and enquiry drafts include event context',()=>{
 for(const url of ['javascript:alert(1)','file:///secret','https://user:password@example.com','http://127.0.0.1','https://test.local'])
  assert.equal(safeWebUrl(url),null);
 assert.equal(safeWebUrl('https://example.com'),'https://example.com/');
 const plan=structuredClone(sampleEvents[0]);
 assert.ok(resourceEnquiry(plan,plan.resources[0]).includes(plan.date));
});

test('choosing a shortlist option preserves other entries, budget and confirmation state',()=>{
 const plan=structuredClone(sampleEvents[0]);
 plan.resources[0].details={kind:'food',enquiry:'Contacted',quote:2000};
 plan.resources[0].status='Requested';
 const before=structuredClone(plan);
 const result=chooseResource(plan,plan.resources[0].id);
 assert.equal(result.resources[0].details.enquiry,'Chosen');
 assert.equal(result.resources[0].status,'Requested');
 assert.deepEqual(result.budget,before.budget);
 assert.deepEqual(result.resources.slice(1),before.resources.slice(1));
 assert.deepEqual(plan,before);
 assert.throws(()=>chooseResource(plan,'missing'));
});