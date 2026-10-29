import { cloudPlanSchema } from '../../../packages/core/src/cloud.ts';
import type { EventPlan } from '../../../packages/core/src/index.ts';
import type { Config } from './config.ts';
export class ApiError extends Error {
 status:number; code:string; constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export interface Repository {
 user(token:string):Promise<string>;
 list(token:string):Promise<EventPlan[]>;
 get(token:string,id:string):Promise<EventPlan|null>;
 write(token:string,plan:EventPlan,expectedRevision:number,operationId:string):Promise<EventPlan>;
}
export type UpstreamDiagnostic={
 event:'supabase_request_failed';stage:'auth'|'list'|'save';elapsedMs:number;
 upstreamStatus?:number;upstreamCode?:string;networkCode?:string;
};
function networkCode(error:unknown){
 const cause=error&&typeof error==='object'&&'cause'in error?error.cause:null;
 const code=cause&&typeof cause==='object'&&'code'in cause?cause.code:null;
 return typeof code==='string'&&['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','EACCES','EPERM'].includes(code)?code:'NETWORK_OR_TIMEOUT';
}
export function createRepository(config:Config,report:(diagnostic:UpstreamDiagnostic)=>void=()=>{},fetcher:typeof fetch=fetch):Repository {
 async function request(path:string,stage:UpstreamDiagnostic['stage'],token:string,body?:unknown):Promise<unknown>{
  const started=performance.now();
  let response:Response;
  try{
   response=await fetcher(config.SUPABASE_URL+path,{
    method:body===undefined?'GET':'POST',
    headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000),
   });
  }catch(error){
   report({event:'supabase_request_failed',stage,elapsedMs:Math.round(performance.now()-started),networkCode:networkCode(error)});
   throw new ApiError(503,'SERVICE_UNAVAILABLE','Could not reach the saved workspace. Retry when connected.');
  }
  const data:unknown=await response.json().catch(()=>null);
  if(!response.ok){
   const rawCode=data&&typeof data==='object'&&'code'in data?data.code:'';
   const code=typeof rawCode==='string'&&/^[A-Z0-9_]{1,32}$/.test(rawCode)?rawCode:'UNKNOWN';
   report({event:'supabase_request_failed',stage,elapsedMs:Math.round(performance.now()-started),upstreamStatus:response.status,upstreamCode:code});
   if(response.status===401)throw new ApiError(401,'UNAUTHORIZED','Your session expired. Sign in again.');
   if(code==='P0002')throw new ApiError(404,'NOT_FOUND','Event not found.');
   if(code==='40001'||code==='23505')throw new ApiError(409,'REVISION_CONFLICT','This event changed elsewhere. Reload the saved version before editing.');
   if(code==='42501'||response.status===403)throw new ApiError(403,'FORBIDDEN','This action is not allowed.');
   throw new ApiError(503,'STORAGE_UNAVAILABLE','The saved workspace is unavailable. Check the database migration and retry.');
  }
  return data;
 }
 function invalid(stage:UpstreamDiagnostic['stage']):never{
  report({event:'supabase_request_failed',stage,elapsedMs:0,upstreamCode:'INVALID_STORED_DATA'});
  throw new ApiError(503,'INVALID_STORED_DATA','The saved event format could not be read. Your data has not been changed.');
 }
 return {
  async user(token){
   const data=await request('/auth/v1/user','auth',token);
   if(!data||typeof data!=='object'||!('id'in data)||typeof data.id!=='string')throw new ApiError(401,'UNAUTHORIZED','Sign in to open your workspace.');
   return data.id;
  },
  async list(token){
   const data=await request('/rest/v1/rpc/read_event_plans','list',token,{});
   const parsed=cloudPlanSchema.array().safeParse(data);
   return parsed.success?parsed.data:invalid('list');
  },
  async get(token,id){
   const data=await request('/rest/v1/rpc/read_event_plan','list',token,{p_event_id:id});
   if(data===null)return null;
   const parsed=cloudPlanSchema.safeParse(data);
   return parsed.success?parsed.data:invalid('list');
  },
  async write(token,plan,expectedRevision,operationId){
   const data=await request('/rest/v1/rpc/write_event_plan','save',token,{p_plan:plan,p_expected_revision:expectedRevision,p_operation_id:operationId});
   const parsed=cloudPlanSchema.safeParse(data);
   return parsed.success?parsed.data:invalid('save');
  },
 };
}
