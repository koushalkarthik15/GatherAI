import { proposalSchema, type SavedProposal } from '../../../../packages/core/src/generation.ts';
import { ApiError } from '../repository.ts';
import type { Config } from '../config.ts';
export type ProposalAction='list'|'reserve'|'complete'|'fail'|'apply'|'discard'|'rollback';
export interface ProposalStore{
 action(token:string,action:ProposalAction,eventId:string,id:string|null,expected:number|null,payload?:unknown):Promise<unknown>;
}
export function readProposal(value:unknown):SavedProposal{
 const result=proposalSchema.safeParse(value);
 if(!result.success)throw new ApiError(503,'INVALID_PROPOSAL','The saved proposal could not be read. Your event has not been changed.');
 return result.data;
}
export function createProposalStore(config:Config,fetcher:typeof fetch=fetch):ProposalStore{
 return {async action(token,action,eventId,id,expected,payload={}){
  let response:Response;
  try{
   response=await fetcher(config.SUPABASE_URL+'/rest/v1/rpc/plan_proposal_action',{
    method:'POST',headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_event:eventId,p_id:id,p_expected:expected,p_payload:payload}),
    signal:AbortSignal.timeout(12000),
   });
  }catch{throw new ApiError(503,'PROPOSAL_STORAGE_UNAVAILABLE','Could not reach proposal storage. Retry without closing this tab.');}
  const value:unknown=await response.json().catch(()=>null);
  if(!response.ok){
   const code=value&&typeof value==='object'&&'code'in value?value.code:'';
   if(code==='P0002')throw new ApiError(404,'NOT_FOUND','Event or proposal not found.');
   if(code==='40001'||code==='23505')throw new ApiError(409,'REVISION_CONFLICT','The event or proposal changed. Reload before applying.');
   if(code==='P1001')throw new ApiError(429,'AI_DAILY_LIMIT','The daily AI request limit is reached. Manual editing remains available.');
   if(code==='P1002')throw new ApiError(409,'AI_BUSY','Generation is running or its lease expired. Reopen proposals shortly.');
   if(code==='P1003')throw new ApiError(409,'EVENT_NOT_EMPTY','Initial generation is available for empty events. Existing work stays protected.');
   if(response.status===401||response.status===403)throw new ApiError(403,'FORBIDDEN','Sign in to access your own proposals.');
   throw new ApiError(503,'PROPOSAL_STORAGE_UNAVAILABLE','Proposal storage is unavailable. Check the API logs and database setup.');
  }
  return value;
 }};
}
