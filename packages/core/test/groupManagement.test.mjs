import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeTaskGroup } from '../src/rules.ts';

test('group removal moves tasks without dropping details and rejects invalid destinations',()=>{
 const event={groups:[{id:'a',name:'First'},{id:'b',name:'Second'}],tasks:[{id:'t',groupId:'a',title:'Task',status:'Done',notes:'Keep'}]};
 const before=structuredClone(event);
 assert.throws(()=>removeTaskGroup(event,'a'));
 assert.throws(()=>removeTaskGroup(event,'a','a'));
 assert.throws(()=>removeTaskGroup(event,'a','other'));
 const result=removeTaskGroup(event,'a','b');
 assert.deepEqual(result.tasks,[{...before.tasks[0],groupId:'b'}]);
 assert.deepEqual(result.groups,[before.groups[1]]);
 assert.deepEqual(event,before);
});