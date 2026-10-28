import { venueSearchResponse } from '@gather/core/sourcing';
import { proposalSchema } from '@gather/core/generation';
import { z } from 'zod';
import { cloudPlanSchema, type CreateEventInput } from '@gather/core/cloud';
import type { EventPlan } from '@gather/core';
import { supabase } from '../auth/client';
// Development uses the same-origin Vite proxy. Production can supply an API origin.
const base=(import.meta.env.VITE_API_URL?.trim()??'').replace(/\/$/,'');
export class SaveError extends Error{
 code:string;requestId?:string;
 constructor(code:string,message:string,requestId?:string){super(message+(requestId?' Reference: '+requestId:''));this.code=code;this.requestId=requestId;}
}
export function cloudApi(userId:string){
 async function request(path:string,method='GET',body?:unknown,operationId?:string):Promise<unknown>{
  if(!supabase)throw new SaveError('NOT_CONFIGURED','Saved workspaces are not configured.');
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session||data.session.user.id!==userId)throw new SaveError('UNAUTHORIZED','Your session changed. Sign in again before saving.');
  const route=path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id');
  let response:Response;
  try{
   response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json',...(operationId?{'Idempotency-Key':operationId}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path.endsWith('/generate')?75000:path.endsWith('/venues')?65000:20000)});
  }catch(error){
   const code=error instanceof Error&&error.name==='TimeoutError'?'REQUEST_TIMEOUT':'NETWORK_ERROR';
   console.error('[Gather API]',{code,method,route,apiOrigin:base||'same-origin'});
   throw new SaveError(code,'Could not reach the workspace API. Your edits remain in this tab. Check the API terminal and retry.');
  }
  const result:unknown=await response.json().catch(()=>null);
  if(!response.ok){
   const parsed=z.object({code:z.string(),message:z.string(),requestId:z.string().optional()}).safeParse(result);
   const rawId=response.headers.get('x-request-id')||(parsed.success?parsed.data.requestId:'');
   const requestId=rawId&&/^[a-zA-Z0-9-]{1,64}$/.test(rawId)?rawId:undefined;
   const code=parsed.success?parsed.data.code:'REQUEST_FAILED';
   console.error('[Gather API]',{code,method,route,status:response.status,requestId});
   throw new SaveError(code,parsed.success?parsed.data.message:'The request failed. Check the API terminal and retry without closing this tab.',requestId);
  }
  return result;
 }
 return {
  async venues(eventId:string,input:{area:string;radiusKm:5|10|20;kind?:'venue'|'food'|'equipment'}){return venueSearchResponse.parse(await request('/api/events/'+eventId+'/venues','POST',input));},
  async aiStatus(){return z.object({enabled:z.boolean(),primary:z.enum(['groq','gemini'])}).parse(await request('/api/ai/status'));},
  async proposals(eventId:string){return z.object({proposals:proposalSchema.array()}).parse(await request('/api/events/'+eventId+'/proposals')).proposals;},
  async generate(eventId:string,expectedRevision:number,operationId:string){return z.object({proposal:proposalSchema}).parse(await request('/api/events/'+eventId+'/generate','POST',{expectedRevision,operationId})).proposal;},
  async decide(eventId:string,proposalId:string,expectedRevision:number,action:'apply'|'discard'|'rollback'){return z.object({proposal:proposalSchema}).parse(await request('/api/events/'+eventId+'/proposals/'+proposalId+'/'+action,'POST',{expectedRevision})).proposal;},
  async list(){const result=await request('/api/events');return z.object({events:z.array(cloudPlanSchema)}).parse(result).events;},
  async get(eventId:string){return z.object({event:cloudPlanSchema}).parse(await request('/api/events/'+eventId)).event;},
  async create(input:CreateEventInput,operationId:string){const result=await request('/api/events','POST',input,operationId);return z.object({event:cloudPlanSchema}).parse(result).event;},
  async save(plan:EventPlan,expectedRevision:number,operationId:string){const result=await request('/api/events/'+plan.id,'PUT',{plan:{...plan,revision:expectedRevision+1},expectedRevision,operationId});return z.object({event:cloudPlanSchema}).parse(result).event;},
 };
}
