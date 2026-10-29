import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { proposalSchema } from '../../../../packages/core/src/generation.ts';
import { ApiError, type Repository } from '../repository.ts';
import type { Config } from '../config.ts';
import { createProviderCall, ProviderError, type ProviderCall, type ProviderSettings } from './providers.ts';
import { generateInitialPlan } from './workflow.ts';
import { createProposalStore, readProposal, type ProposalStore } from './store.ts';
export type AiDependencies={store:ProposalStore;call:ProviderCall};
export function providerSettings(config:Config):ProviderSettings{
 return {groqKey:config.GROQ_API_KEY??'',geminiKey:config.GEMINI_API_KEY??'',
  groqModel:config.GROQ_MODEL??'',geminiModel:config.GEMINI_MODEL??'',primary:config.AI_PRIMARY_PROVIDER??'groq'};
}
export function registerAiRoutes(app:FastifyInstance,config:Config,repository:(request:FastifyRequest)=>Repository,deps?:AiDependencies){
 const settings=providerSettings(config),store=deps?.store??createProposalStore(config),call=deps?.call??createProviderCall(settings);
 const configured=Boolean(settings.groqKey&&settings.geminiKey&&settings.groqModel&&settings.geminiModel);
 const token=(request:FastifyRequest)=>request.headers.authorization!.slice(7);
 const params=(request:FastifyRequest)=>z.object({id:z.uuid()}).parse(request.params);
 app.get('/api/ai/status',async()=>({enabled:configured,primary:settings.primary}));
 app.get('/api/events/:id/proposals',async request=>{
  const {id}=params(request);
  const result=await store.action(token(request),'list',id,null,null);
  return {proposals:proposalSchema.array().parse(result)};
 });
 app.post('/api/events/:id/generate',async request=>{
  if(!configured&&!deps)throw new ApiError(503,'AI_NOT_CONFIGURED','Add both provider keys and model names to apps/api/.env, then restart the API.');
  const {id}=params(request);
  const body=z.object({operationId:z.uuid(),expectedRevision:z.number().int().nonnegative()}).strict().parse(request.body);
  const plan=await repository(request).get(token(request),id);
  if(!plan)throw new ApiError(404,'NOT_FOUND','Event not found.');
  if(plan.revision!==body.expectedRevision)throw new ApiError(409,'REVISION_CONFLICT','Save or reload the latest event before generating.');

  const cacheKey=createHash('sha256').update(JSON.stringify({version:'additive-v2',revision:plan.revision,
   primary:settings.primary,groq:settings.groqModel,gemini:settings.geminiModel})).digest('hex');
  const reserved=readProposal(await store.action(token(request),'reserve',id,body.operationId,body.expectedRevision,{cacheKey}));
  if(reserved.status!=='running')return {proposal:reserved};
  try{
   const generated=await generateInitialPlan(plan,settings.primary,call,diagnostic=>request.log.info({...diagnostic,model:diagnostic.provider==='groq'?settings.groqModel:settings.geminiModel},'AI attempt completed'));
   const proposal=readProposal(await store.action(token(request),'complete',id,reserved.id,body.expectedRevision,generated));
   return {proposal};
  }catch(error){
   try{await store.action(token(request),'fail',id,reserved.id,body.expectedRevision);}catch{request.log.warn({event:'ai_reservation_release_failed'},'AI lease will expire automatically');}
   if(error instanceof ApiError)throw error;
   const code=error instanceof ProviderError?error.code:'AI_GENERATION_FAILED';
   throw new ApiError(503,code,code==='AI_PROVIDER_AUTH'||code==='AI_PROVIDER_CONFIG'
    ?'The AI provider configuration was rejected. Check its key and model in apps/api/.env.'
    :'AI could not produce a valid plan. Your saved event is unchanged. Reopen proposals before retrying.');
  }
 });
 app.post('/api/events/:id/proposals/:proposalId/:action',async request=>{
  const {id,proposalId,action}=z.object({id:z.uuid(),proposalId:z.uuid(),action:z.enum(['apply','discard','rollback'])}).parse(request.params);
  const {expectedRevision}=z.object({expectedRevision:z.number().int().nonnegative()}).strict().parse(request.body);
  return {proposal:readProposal(await store.action(token(request),action,id,proposalId,expectedRevision))};
 });
}
