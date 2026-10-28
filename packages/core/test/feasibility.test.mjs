import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feasibilitySummary } from '../src/rules.ts';

test('feasibility uses confirmed ceiling and higher of actual or estimate per item',()=>{
 const event={confirmed:10000,pending:50000,limit:8000,budget:[
  {estimate:5000,actual:7000},{estimate:3000,actual:0}
 ],resources:[{status:'Confirmed'},{status:'Requested'},{status:'Reconfirmation needed'}],tasks:[{status:'Done'},{status:'Blocked'}]};
 const summary=feasibilitySummary(event);
 assert.equal(summary.ceiling,8000);assert.equal(summary.exposure,10000);assert.equal(summary.remaining,-2000);
 assert.equal(summary.pending,50000);assert.equal(summary.resourcesConfirmed,1);assert.equal(summary.resourcesOutstanding,2);assert.equal(summary.tasksBlocked,1);
});
test('empty records remain distinguishable from confirmed readiness',()=>{
 const result=feasibilitySummary({confirmed:0,pending:0,limit:0,budget:[],resources:[],tasks:[]});
 assert.equal(result.budgetItems,0);assert.equal(result.resourcesRecorded,0);assert.equal(result.tasksRecorded,0);
});