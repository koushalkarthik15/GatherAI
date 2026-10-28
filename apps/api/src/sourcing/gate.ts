import { z } from 'zod';
import type { Config } from '../config.ts';
import { DirectoryError, type DirectoryGate } from './directory.ts';

const reply=z.discriminatedUnion('status',[
 z.object({status:z.literal('reserved'),lease:z.uuid()}),
 z.object({status:z.literal('busy')}),
 z.object({status:z.literal('limit')}),
 z.object({status:z.literal('released')}),
]);
export function createDirectoryGate(config:Config,token:string,fetcher:typeof fetch=fetch):DirectoryGate{
 async function call(action:'reserve'|'release',lease?:string){
  let response:Response;
  try{
   response=await fetcher(config.SUPABASE_URL+'/rest/v1/rpc/directory_gate_action',{
    method:'POST',headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_lease:lease??null}),signal:AbortSignal.timeout(12000),
   });
  }catch{throw new DirectoryError('DIRECTORY_GATE_UNAVAILABLE');}
  const parsed=reply.safeParse(await response.json().catch(()=>null));
  if(!response.ok||!parsed.success)throw new DirectoryError('DIRECTORY_GATE_UNAVAILABLE');
  return parsed.data;
 }
 return {
  async reserve(){
   const result=await call('reserve');
   if(result.status==='busy')throw new DirectoryError('DIRECTORY_BUSY');
   if(result.status==='limit')throw new DirectoryError('DIRECTORY_LIMIT');
   if(result.status!=='reserved')throw new DirectoryError('DIRECTORY_GATE_UNAVAILABLE');
   return result.lease;
  },
  async release(lease){const result=await call('release',lease);if(result.status!=='released')throw new DirectoryError('DIRECTORY_GATE_UNAVAILABLE');},
 };
}
