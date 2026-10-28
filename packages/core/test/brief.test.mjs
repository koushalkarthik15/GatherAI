import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventBriefSchema } from '../src/index.ts';
import { createEventInput } from '../src/cloud.ts';

test('event brief validates optional details and protects limits',()=>{
 assert.deepEqual(eventBriefSchema.parse({durationMinutes:120,availableResources:' Chairs '}),{durationMinutes:120,availableResources:'Chairs'});
 assert.equal(eventBriefSchema.safeParse({durationMinutes:0}).success,false);
 assert.equal(eventBriefSchema.safeParse({durationMinutes:1.5}).success,false);
 assert.equal(eventBriefSchema.safeParse({knownCosts:'x'.repeat(401)}).success,false);
 assert.equal(eventBriefSchema.safeParse({unrecognized:'value'}).success,false);
 const input={name:'Event',description:'A gathering',kind:'Community gathering',date:'2026-12-01',location:'Campus',guests:20,confirmed:0,limit:0};
 assert.equal(createEventInput.safeParse(input).success,true);
 assert.equal(createEventInput.safeParse({...input,brief:{mustHaves:'Accessible room'}}).success,true);
});