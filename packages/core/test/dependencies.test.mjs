import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskDependencies } from '../src/rules.ts';

test('prerequisites reject missing tasks, self-links and indirect cycles',()=>{
 const tasks=[{id:'a',dependsOn:'b'},{id:'b',dependsOn:'c'},{id:'c',dependsOn:null}];
 assert.doesNotThrow(()=>validateTaskDependencies(tasks));
 assert.throws(()=>validateTaskDependencies([{id:'a',dependsOn:'missing'}]));
 assert.throws(()=>validateTaskDependencies([{id:'a',dependsOn:'a'}]));
 assert.throws(()=>validateTaskDependencies([{id:'a',dependsOn:'b'},{id:'b',dependsOn:'a'}]));
});