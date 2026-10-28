import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../src/buildApp.ts';
import { createRepository, type Repository, type UpstreamDiagnostic } from '../src/repository.ts';
import type { Config } from '../src/config.ts';
import { safeLogger } from '../src/logging.ts';

const config:Config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-key-do-not-log',WEB_ORIGIN:'http://localhost:5173',PORT:3001,HOST:'127.0.0.1'};
test('request IDs correlate logs and responses without credentials, query strings or bodies',async()=>{
 let output='';
 const stream=new Writable({write(chunk,_encoding,done){output+=chunk.toString();done();}});
 const repo:Repository={user:async()=> 'verified-user',list:async()=>[],get:async()=>null,write:async(_token,plan)=>plan};
 const logger=typeof safeLogger==='object'?{...safeLogger,stream}:{stream};
 const app=await buildApp(config,repo,logger);
 try{
  const response=await app.inject({method:'POST',url:'/api/events?access_token=query-secret',headers:{authorization:'Bearer bearer-secret','x-request-id':'untrusted-id'},payload:{password:'body-secret'}});
  assert.equal(response.statusCode,400);
  const id=response.headers['x-request-id'];
  assert.equal(response.json().requestId,id);assert.notEqual(id,'untrusted-id');
  assert.ok(output.includes(String(id)));assert.ok(output.includes('INVALID_INPUT'));assert.ok(output.includes('http_request'));
  for(const secret of ['bearer-secret','body-secret','query-secret','untrusted-id'])assert.ok(!output.includes(secret));
 }finally{await app.close();}
});
test('upstream diagnostics identify the failing stage without logging provider payloads',async()=>{
 const diagnostics:UpstreamDiagnostic[]=[];
 const fetcher:typeof fetch=async()=>new Response(JSON.stringify({code:'PGRST202',message:'provider-detail-secret',details:'event-content-secret'}),{status:404,headers:{'Content-Type':'application/json'}});
 const repo=createRepository(config,value=>diagnostics.push(value),fetcher);
 await assert.rejects(()=>repo.list('bearer-secret'));
 assert.equal(diagnostics[0].stage,'list');assert.equal(diagnostics[0].upstreamStatus,404);assert.equal(diagnostics[0].upstreamCode,'PGRST202');
 const serialized=JSON.stringify(diagnostics);
 for(const secret of ['bearer-secret','provider-detail-secret','event-content-secret','public-key-do-not-log'])assert.ok(!serialized.includes(secret));
});
test('upstream connection errors expose only an allowlisted network code',async()=>{
 const diagnostics:UpstreamDiagnostic[]=[];
 const fetcher:typeof fetch=async()=>{throw Object.assign(new Error('private connection details'),{cause:{code:'ENOTFOUND'}});};
 const repo=createRepository(config,value=>diagnostics.push(value),fetcher);
 await assert.rejects(()=>repo.user('bearer-secret'),/Could not reach/);
 assert.equal(diagnostics[0].stage,'auth');assert.equal(diagnostics[0].networkCode,'ENOTFOUND');
 assert.ok(!JSON.stringify(diagnostics).includes('private connection details'));
});
test('single event lookup uses the owner-scoped RPC and handles missing or invalid data',async()=>{
 const calls:{url:string;body:unknown}[]=[];
 let response:unknown=null;
 const fetcher:typeof fetch=async(input,init)=>{
  calls.push({url:String(input),body:JSON.parse(String(init?.body))});
  return new Response(JSON.stringify(response),{headers:{'Content-Type':'application/json'}});
 };
 const repo=createRepository(config,()=>{},fetcher);
 const id='00000000-0000-4000-8000-000000000001';
 assert.equal(await repo.get('owner-token',id),null);
 assert.ok(calls[0].url.endsWith('/rest/v1/rpc/read_event_plan'));
 assert.deepEqual(calls[0].body,{p_event_id:id});
 response={id};
 await assert.rejects(()=>repo.get('owner-token',id),/format could not be read/);
});
