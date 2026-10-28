import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewFunding } from '../src/rules.ts';

test('funding scenario protects amounts and excludes pending funds',()=>{
 const event={confirmed:12000,limit:10000,pending:100000,budget:[
  {estimate:5000,actual:6000,committed:true},
  {estimate:3000,actual:1000,committed:false}
 ]};
 const before=structuredClone(event);
 const result=previewFunding(event,8000,9000);
 assert.equal(result.current.ceiling,10000);
 assert.equal(result.ceiling,8000);assert.equal(result.exposure,9000);assert.equal(result.remaining,-1000);
 assert.equal(result.protectedCost,7000);assert.deepEqual(event,before);
});
test('funding scenario rejects invalid values',()=>{
 const event={confirmed:0,limit:0,pending:0,budget:[]};
 for(const value of [-1,1.5,NaN,Infinity,1000000001]) {
  assert.throws(()=>previewFunding(event,value,0));assert.throws(()=>previewFunding(event,0,value));
 }
});