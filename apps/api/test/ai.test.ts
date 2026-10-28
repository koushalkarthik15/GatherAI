import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generatedPlanSchema, materializeGeneratedPlan } from '@gather/core/generation';
import type { EventPlan } from '@gather/core';
import { createProviderCall, MAX_OUTPUT_TOKENS, ProviderError, type ProviderCall, type ProviderSettings } from '../src/ai/providers.ts';
import { generateInitialPlan, type AttemptDiagnostic } from '../src/ai/workflow.ts';
import { buildApp } from '../src/buildApp.ts';
import { ApiError, type Repository } from '../src/repository.ts';
import type { Config } from '../src/config.ts';
import type { ProposalStore } from '../src/ai/store.ts';
const empty=():EventPlan=>({
 id:randomUUID(),name:'Community afternoon',description:'An accessible gathering for students',kind:'Community gathering',
 date:'2026-12-01',location:'Campus hall',guests:20,confirmed:100000,limit:100000,pending:900000,
 color:'cobalt',revision:0,groups:[],tasks:[],budget:[],resources:[],agenda:[],
});
const output=()=>({
 summary:'A community afternoon within the stated funds',assumptions:['Prices need local confirmation'],
 groups:[{name:'Preparation'}],tasks:[{group:0,title:'Confirm access arrangements',notes:'Ask about step-free access',due:'2026-11-30',priority:'High'}],
 budget:[{name:'Refreshments',category:'Food',estimate:50000}],resources:[{name:'Chairs',source:'Ask campus facilities'}],
 agenda:[{time:'14:00',title:'Welcome'}],
});
test('generation assigns IDs and statuses server-side and rejects excess budgets and invalid references',()=>{
 const plan=empty();plan.groups=[{id:randomUUID(),name:'Preparation'},{id:randomUUID(),name:'Custom organizer group'}];
 const before=structuredClone(plan);
 const result=materializeGeneratedPlan(plan,output(),randomUUID);
 assert.deepEqual(plan,before);assert.equal(result.plan.revision,0);
 assert.equal(result.plan.tasks[0].status,'To do');assert.equal(result.plan.resources[0].status,'Needed');
 assert.equal(result.plan.budget[0].actual,0);assert.equal(result.plan.budget[0].committed,false);
 assert.equal(result.plan.tasks[0].groupId,plan.groups[0].id);assert.deepEqual(result.plan.groups,plan.groups);
 const again=materializeGeneratedPlan(result.plan,output(),randomUUID);assert.deepEqual(again.plan,result.plan);
 assert.throws(()=>materializeGeneratedPlan({...plan,confirmed:1},output(),randomUUID));
 assert.throws(()=>materializeGeneratedPlan(plan,{...output(),tasks:[{...output().tasks[0],group:4}]},randomUUID));
 assert.throws(()=>materializeGeneratedPlan(plan,{...output(),tasks:[{...output().tasks[0],due:'2026-02-30'}]},randomUUID));
 assert.throws(()=>generatedPlanSchema.parse({...output(),owner_id:randomUUID()}));
 assert.throws(()=>generatedPlanSchema.parse({...output(),budget:[{...output().budget[0],actual:100}]}));
});
test('populated event suggestions preserve existing entries and enforce remaining funds',()=>{
 const plan=empty();
 const generated=materializeGeneratedPlan(plan,output(),randomUUID).plan;
 generated.tasks[0].status='Done';generated.tasks[0].notes='Organizer changes';
 generated.budget[0].actual=60000;generated.budget[0].committed=true;
 generated.resources[0].status='Confirmed';
 const before=structuredClone(generated);
 const addition=output();addition.tasks[0].title='Arrange music';addition.budget[0].name='Sound';addition.budget[0].estimate=40000;
 addition.resources[0].name='Microphones';addition.agenda[0].title='Performance';
 const result=materializeGeneratedPlan(generated,addition,randomUUID).plan;
 assert.deepEqual(generated,before);
 for(const key of ['groups','tasks','budget','resources','agenda'] as const)assert.deepEqual(result[key].slice(0,before[key].length),before[key]);
 assert.equal(result.tasks.at(-1)?.title,'Arrange music');assert.equal(result.budget.at(-1)?.estimate,40000);
 addition.budget[0].estimate=40001;assert.throws(()=>materializeGeneratedPlan(generated,addition,randomUUID));
});
test('initial generation receives organizer brief and preserves it in the proposed plan',async()=>{
 const plan=empty();
 plan.brief={durationMinutes:120,availableResources:'Campus chairs',mustHaves:'Student speakers',accessibility:'Step-free access',knownCosts:'Hall quote INR 5000'};
 let prompt='';
 const result=await generateInitialPlan(plan,'groq',async(provider,text)=>{
  prompt=text;return {value:output(),provider,model:'fixture',tokens:1};
 });
 assert.ok(prompt.includes('Campus chairs'));assert.ok(prompt.includes('Step-free access'));
 assert.ok(prompt.includes('Hall quote INR 5000'));assert.ok(prompt.includes('availableForAdditionalCosts'));
 assert.ok(prompt.includes('unverified context'));assert.ok(prompt.includes('campus facilities'));
 assert.ok(prompt.includes('missing start time'));assert.deepEqual(result.plan.brief,plan.brief);
});
test('LangGraph returns primary success with one call and safe diagnostic fields',async()=>{
 const calls:string[]=[],logs:AttemptDiagnostic[]=[];
 const result=await generateInitialPlan(empty(),'groq',async provider=>{
  calls.push(provider);return {value:output(),provider,model:'fixture',tokens:100};
 },log=>logs.push(log));
 assert.deepEqual(calls,['groq']);assert.equal(result.attempts,1);
 assert.deepEqual(Object.keys(logs[0]).sort(),['attempt','code','elapsedMs','event','provider','tokens'].sort());
 assert.ok(!JSON.stringify(logs).includes('Community afternoon'));
});
test('transient primary failure falls back once and both outages never cause a third call',async()=>{
 const calls:string[]=[];
 const call:ProviderCall=async provider=>{
  calls.push(provider);
  if(provider==='groq')throw new ProviderError('AI_RATE_LIMIT',true);
  return {value:output(),provider,model:'fixture',tokens:200};
 };
 const result=await generateInitialPlan(empty(),'groq',call);
 assert.deepEqual(calls,['groq','gemini']);assert.equal(result.provider,'gemini');assert.equal(result.attempts,2);
 let attempts=0;
 await assert.rejects(()=>generateInitialPlan(empty(),'groq',async()=>{
  attempts++;throw new ProviderError('AI_PROVIDER_UNAVAILABLE',true);
 }));
 assert.equal(attempts,2);
});
test('auth/config errors do not fail over and invalid output has only one bounded regeneration',async()=>{
 let count=0;
 await assert.rejects(()=>generateInitialPlan(empty(),'groq',async()=>{
  count++;throw new ProviderError('AI_PROVIDER_AUTH');
 }));
 assert.equal(count,1);
 const calls:string[]=[];
 await assert.rejects(()=>generateInitialPlan(empty(),'gemini',async provider=>{
  calls.push(provider);return {value:{malformed:true},provider,model:'fixture',tokens:1};
 }));
 assert.deepEqual(calls,['gemini','gemini']);
 const afterFallback:string[]=[];
 await assert.rejects(()=>generateInitialPlan(empty(),'groq',async provider=>{
  afterFallback.push(provider);
  if(provider==='groq')throw new ProviderError('AI_NETWORK_OR_TIMEOUT',true);
  return {value:{malformed:true},provider,model:'fixture',tokens:1};
 }));
 assert.deepEqual(afterFallback,['groq','gemini']);
});
const settings:ProviderSettings={groqKey:'groq-secret',geminiKey:'gemini-secret',groqModel:'openai/gpt-oss-20b',geminiModel:'gemini-3.5-flash-lite',primary:'groq'};
test('provider adapters use bounded structured output, header secrets and reject truncation',async()=>{
 const requests:{url:string;body:Record<string,unknown>;headers:Headers}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  requests.push({url:String(input),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});
  return new Response(JSON.stringify(String(input).includes('groq')?
   {choices:[{message:{content:JSON.stringify(output())},finish_reason:'stop'}],usage:{total_tokens:12}}:
   {candidates:[{content:{parts:[{text:JSON.stringify(output())}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:14}}));
 };
 const call=createProviderCall(settings,fetcher);
 assert.equal((await call('groq','brief')).tokens,12);assert.equal((await call('gemini','brief')).tokens,14);
 assert.equal(requests[0].body.max_completion_tokens,MAX_OUTPUT_TOKENS);
 assert.equal((requests[1].body.generationConfig as Record<string,unknown>).maxOutputTokens,MAX_OUTPUT_TOKENS);
 assert.ok(!requests.some(request=>request.url.includes('secret')));
 assert.equal(requests[1].headers.get('x-goog-api-key'),'gemini-secret');
 const truncated=createProviderCall(settings,async()=>new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'length'}]})));
 await assert.rejects(()=>truncated('groq','brief'),/AI_INVALID_OUTPUT/);
 let sent=0;const bounded=createProviderCall(settings,async()=>{sent++;return new Response();});
 await assert.rejects(()=>bounded('groq','x'.repeat(13000)),/AI_INPUT_TOO_LARGE/);assert.equal(sent,0);
});
test('provider status failures classify transient errors without leaking upstream bodies',async()=>{
 for(const [status,transient] of [[429,true],[503,true],[401,false],[400,false]] as const){
  const call=createProviderCall(settings,async()=>new Response('private upstream secret',{status}));
  await assert.rejects(()=>call('groq','brief'),(error:unknown)=>
   error instanceof ProviderError&&error.transient===transient&&!error.message.includes('private'));
 }
});
const config:Config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-public-key-placeholder',WEB_ORIGIN:'http://localhost:5173',PORT:3001,HOST:'127.0.0.1'};
test('generation API enforces session/ownership/revision before reserving or invoking providers',async()=>{
 const plan=empty();let reservations=0,calls=0;
 const repo:Repository={
  async user(token){if(token!=='owner')throw new ApiError(401,'UNAUTHORIZED','Invalid session');return token;},
  async list(){return [plan];},async get(_token,id){return id===plan.id?plan:null;},async write(){throw new Error('Should not write live plan during generation');},
 };
 const store:ProposalStore={async action(_token,action){
  if(action==='reserve')reservations++;
  throw new ApiError(429,'AI_DAILY_LIMIT','Limit reached');
 }};
 const app=await buildApp(config,repo,false,{store,call:async provider=>{calls++;return {value:output(),provider,model:'fixture',tokens:1};}});
 const payload={operationId:randomUUID(),expectedRevision:0},headers={authorization:'Bearer owner'};
 try{
  assert.equal((await app.inject({method:'POST',url:'/api/events/'+plan.id+'/generate',payload})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/events/'+randomUUID()+'/generate',headers,payload})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/events/'+plan.id+'/generate',headers,payload:{...payload,expectedRevision:2}})).statusCode,409);
  assert.equal(reservations,0);
  assert.equal((await app.inject({method:'POST',url:'/api/events/'+plan.id+'/generate',headers,payload})).statusCode,429);
  assert.equal(reservations,1);assert.equal(calls,0);
  plan.tasks=materializeGeneratedPlan(plan,output(),randomUUID).plan.tasks;
  assert.equal((await app.inject({method:'POST',url:'/api/events/'+plan.id+'/generate',headers,payload})).statusCode,429);
  assert.equal(calls,0);assert.equal(reservations,2);
 }finally{await app.close();}
});
test('generation API persists a proposal and reuses a ready result without additional model calls',async()=>{
 const plan=empty();let calls=0;
 let saved:Record<string,unknown>|null=null;
 const repo:Repository={async user(){return 'owner';},async list(){return [plan];},async get(_token,id){return id===plan.id?plan:null;},async write(){throw new Error('No live writes');}};
 const store:ProposalStore={async action(_token,action,_event,id,revision,payload){
  if(action==='reserve')return saved??{id,eventId:plan.id,baseRevision:revision,status:'running',plan:null,summary:'',assumptions:[],provider:'',model:'',attempts:0,appliedRevision:null};
  if(action==='complete'){saved={...(payload as object),id,eventId:plan.id,baseRevision:revision,status:'ready',appliedRevision:null};return saved;}
  throw new Error('Unexpected action');
 }};
 const app=await buildApp(config,repo,false,{store,call:async provider=>{calls++;return {value:output(),provider,model:'fixture',tokens:1};}});
 try{
  const request={method:'POST' as const,url:'/api/events/'+plan.id+'/generate',headers:{authorization:'Bearer owner'},payload:{operationId:randomUUID(),expectedRevision:0}};
  const response=await app.inject(request);assert.equal(response.statusCode,200);
  assert.equal(response.json().proposal.status,'ready');assert.equal(plan.tasks.length,0);
  assert.equal((await app.inject(request)).statusCode,200);assert.equal(calls,1);
 }finally{await app.close();}
});

test('populated generation API returns a reviewed additive proposal without live writes',async()=>{
 const plan=empty();plan.brief={mustHaves:'Step-free access'};
 plan.groups=[{id:randomUUID(),name:'Organizer'}];
 plan.tasks=[{id:randomUUID(),groupId:plan.groups[0].id,title:'Existing task',notes:'Keep this',owner:'Organizer',due:'',priority:'High',status:'Done'}];
 const before=structuredClone(plan);let prompt='';
 const repo:Repository={async user(){return 'owner';},async list(){return [plan];},async get(_token,id){return id===plan.id?plan:null;},async write(){throw new Error('No live writes');}};
 const store:ProposalStore={async action(_token,action,_event,id,revision,payload){
  if(action==='reserve')return {id,eventId:plan.id,baseRevision:revision,status:'running',plan:null,summary:'',assumptions:[],provider:'',model:'',attempts:0,appliedRevision:null};
  if(action==='complete')return {...(payload as object),id,eventId:plan.id,baseRevision:revision,status:'ready',appliedRevision:null};
  throw new Error('Unexpected action');
 }};
 const app=await buildApp(config,repo,false,{store,call:async(provider,input)=>{prompt=input;return {value:output(),provider,model:'fixture',tokens:1};}});
 try{
  const response=await app.inject({method:'POST',url:'/api/events/'+plan.id+'/generate',headers:{authorization:'Bearer owner'},payload:{operationId:randomUUID(),expectedRevision:0}});
  assert.equal(response.statusCode,200);assert.ok(prompt.includes('Step-free access'));assert.ok(prompt.includes('Existing task'));
  assert.deepEqual(response.json().proposal.plan.tasks[0],before.tasks[0]);assert.deepEqual(plan,before);
 }finally{await app.close();}
});