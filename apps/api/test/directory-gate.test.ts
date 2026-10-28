import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../src/config.ts';
import { createDirectoryGate } from '../src/sourcing/gate.ts';
const config:Config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture',WEB_ORIGIN:'http://localhost:5173',PORT:3001,HOST:'127.0.0.1'};
test('shared gate reserves and releases with the user token and fails closed',async()=>{
 const calls:{url:string;body:unknown;auth:string|null}[]=[];
 let answer:unknown={status:'reserved',lease:'00000000-0000-4000-8000-000000000001'};
 const gate=createDirectoryGate(config,'fixture-token',async(input,init)=>{
  calls.push({url:String(input),body:JSON.parse(String(init?.body)),auth:new Headers(init?.headers).get('authorization')});
  return new Response(JSON.stringify(answer));
 });
 const lease=await gate.reserve();
 assert.equal(lease,'00000000-0000-4000-8000-000000000001');
 assert.equal(calls[0].auth,'Bearer fixture-token');
 assert.ok(calls[0].url.endsWith('/rest/v1/rpc/directory_gate_action'));
 answer={status:'released'};
 await gate.release(lease);
 assert.deepEqual(calls[1].body,{p_action:'release',p_lease:lease});
 answer={status:'busy'};await assert.rejects(()=>gate.reserve(),/DIRECTORY_BUSY/);
 answer={status:'limit'};await assert.rejects(()=>gate.reserve(),/DIRECTORY_LIMIT/);
 answer={status:'reserved',lease:'invalid'};await assert.rejects(()=>gate.reserve(),/DIRECTORY_GATE_UNAVAILABLE/);
 const offline=createDirectoryGate(config,'fixture-token',async()=>{throw new Error('network');});
 await assert.rejects(()=>offline.reserve(),/DIRECTORY_GATE_UNAVAILABLE/);
});
