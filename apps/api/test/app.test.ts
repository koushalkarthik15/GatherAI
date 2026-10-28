import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/buildApp.ts';
import { ApiError, type Repository } from '../src/repository.ts';
import type { Config } from '../src/config.ts';
import type { EventPlan } from '@gather/core';

const config:Config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable-placeholder',WEB_ORIGIN:'http://localhost:5173',PORT:3001,HOST:'127.0.0.1'};
function fixture(){
 const events=new Map<string,{owner:string;plan:EventPlan}>();
 const operations=new Map<string,EventPlan>();
 let calls=0;
 const repo:Repository={
  async user(token){if(token!=='user-a'&&token!=='user-b')throw new ApiError(401,'UNAUTHORIZED','Invalid session.');return token;},
  async list(token){return Array.from(events.values()).filter(e=>e.owner===token).map(e=>structuredClone(e.plan));},
  async get(token,id){const entry=events.get(id);return entry?.owner===token?structuredClone(entry.plan):null;},
  async write(token,plan,expected,operationId){
   calls++;
   const existing=events.get(plan.id);
   if(existing&&existing.owner!==token)throw new ApiError(404,'NOT_FOUND','Event not found.');
   const repeated=operations.get(plan.id+operationId);
   if(repeated)return structuredClone(repeated);
   if((existing?.plan.revision??-1)!==expected)throw new ApiError(409,'REVISION_CONFLICT','Stale revision.');
   events.set(plan.id,{owner:token,plan:structuredClone(plan)});
   operations.set(plan.id+operationId,structuredClone(plan));return plan;
  },
 };
 return {repo,calls:()=>calls};
}
const input={name:'Community afternoon',description:'A gathering for local students',kind:'Community gathering',date:'2026-11-14',location:'Community hall',guests:50,confirmed:100000,limit:100000};
const headers=(token='user-a')=>({authorization:'Bearer '+token});
test('API rejects unauthenticated and forged sessions before data access',async()=>{
 const f=fixture(),app=await buildApp(config,f.repo,false);
 try{
  assert.equal((await app.inject({method:'GET',url:'/api/events'})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:'/api/events',headers:headers('forged')})).statusCode,401);
  assert.equal(f.calls(),0);
 }finally{await app.close();}
});
test('create/list/save use real Fastify contracts with an injected test repository',async()=>{
 const f=fixture(),app=await buildApp(config,f.repo,false);
 try{
  const operationId=randomUUID();
  const created=await app.inject({method:'POST',url:'/api/events',headers:{...headers(),'idempotency-key':operationId},payload:input});
  assert.equal(created.statusCode,201);
  const plan=created.json().event as EventPlan;
  assert.equal(plan.id,operationId);assert.equal(plan.tasks.length,0);
  const retry=await app.inject({method:'POST',url:'/api/events',headers:{...headers(),'idempotency-key':operationId},payload:input});
  assert.equal(retry.statusCode,201);assert.deepEqual(retry.json().event,plan);
  const next={...plan,name:'Updated title',revision:1};
  const saved=await app.inject({method:'PUT',url:'/api/events/'+plan.id,headers:headers(),payload:{plan:next,expectedRevision:0,operationId:randomUUID()}});
  assert.equal(saved.statusCode,200);
  const listed=await app.inject({method:'GET',url:'/api/events',headers:headers()});
  assert.equal(listed.json().events[0].name,'Updated title');
  assert.equal((await app.inject({method:'GET',url:'/api/events/'+plan.id,headers:headers()})).json().event.name,'Updated title');
  assert.equal((await app.inject({method:'GET',url:'/api/events/'+plan.id,headers:headers('user-b')})).statusCode,404);
  assert.equal((await app.inject({method:'GET',url:'/api/events/'+randomUUID(),headers:headers()})).statusCode,404);
 }finally{await app.close();}
});
test('API propagates ownership denial and revision conflicts without overwriting',async()=>{
 const f=fixture(),app=await buildApp(config,f.repo,false);
 try{
  const created=await app.inject({method:'POST',url:'/api/events',headers:{...headers(),'idempotency-key':randomUUID()},payload:input});
  const plan=created.json().event as EventPlan;
  const payload={plan:{...plan,revision:1},expectedRevision:0,operationId:randomUUID()};
  const other=await app.inject({method:'PUT',url:'/api/events/'+plan.id,headers:headers('user-b'),payload});
  assert.equal(other.statusCode,404);
  assert.deepEqual((await app.inject({method:'GET',url:'/api/events',headers:headers('user-b')})).json().events,[]);
  assert.equal((await app.inject({method:'PUT',url:'/api/events/'+plan.id,headers:headers(),payload})).statusCode,200);
  assert.equal((await app.inject({method:'PUT',url:'/api/events/'+plan.id,headers:headers(),payload:{...payload,operationId:randomUUID()}})).statusCode,409);
 }finally{await app.close();}
});
test('invalid dates, forged owner and mismatched IDs fail validation',async()=>{
 const f=fixture(),app=await buildApp(config,f.repo,false);
 try{
  for(const payload of [{...input,date:'2026-02-30'},{...input,owner_id:randomUUID()},{...input,guests:0}]){
   const result=await app.inject({method:'POST',url:'/api/events',headers:{...headers(),'idempotency-key':randomUUID()},payload});
   assert.equal(result.statusCode,400);
  }
  assert.equal(f.calls(),0);
 }finally{await app.close();}
});
test('data service failure is explicit and response does not leak internals',async()=>{
 const f=fixture();
 f.repo.list=async()=>{throw new Error('internal-secret-details');};
 const app=await buildApp(config,f.repo,false);
 try{
  const result=await app.inject({method:'GET',url:'/api/events',headers:headers()});
  assert.equal(result.statusCode,500);assert.ok(!result.body.includes('internal-secret-details'));
  assert.ok(result.json().requestId);
 }finally{await app.close();}
});
test('CORS accepts only the configured browser origin and supports create idempotency header',async()=>{
 const app=await buildApp(config,fixture().repo,false);
 try{
  const response=await app.inject({method:'OPTIONS',url:'/api/events',headers:{origin:config.WEB_ORIGIN,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,idempotency-key'}});
  assert.equal(response.headers['access-control-allow-origin'],config.WEB_ORIGIN);
  assert.ok(String(response.headers['access-control-allow-headers']).toLowerCase().includes('idempotency-key'));
  const denied=await app.inject({method:'OPTIONS',url:'/api/events',headers:{origin:'https://untrusted.example','access-control-request-method':'POST'}});
  assert.notEqual(denied.headers['access-control-allow-origin'],'https://untrusted.example');
 }finally{await app.close();}
});

test('API responses prevent caching of account data and declare safe content handling',async()=>{
 const app=await buildApp(config,fixture().repo,false);
 try{
  for(const options of [
   {method:'GET' as const,url:'/health'},
   {method:'GET' as const,url:'/api/events',headers:headers()},
   {method:'GET' as const,url:'/api/events'},
  ]){
   const response=await app.inject(options);
   assert.equal(response.headers['cache-control'],'no-store');
   assert.equal(response.headers['x-content-type-options'],'nosniff');
   assert.equal(response.headers['referrer-policy'],'no-referrer');
   assert.equal(response.headers['content-security-policy'],"default-src 'none'; frame-ancestors 'none'");
  }
 }finally{await app.close();}
});
