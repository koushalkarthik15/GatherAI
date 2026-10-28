import { registerSourcingRoutes } from './sourcing/routes.ts';
import type { Directory } from './sourcing/directory.ts';
import { registerAiRoutes, type AiDependencies } from './ai/routes.ts';
import Fastify, { LogController, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { createHash, randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { createEventInput, saveEventInput } from '@gather/core/cloud';
import type { EventPlan } from '@gather/core';
import { ApiError, createRepository, type Repository } from './repository.ts';
import type { Config } from './config.ts';
import { safeLogger } from './logging.ts';

export async function buildApp(config:Config,repo?:Repository,logger:FastifyServerOptions['logger']=safeLogger,ai?:AiDependencies,directory?:Directory){
 const app=Fastify({bodyLimit:262144,requestTimeout:20000,logger,logController:new LogController({disableRequestLogging:true}),genReqId:()=>randomUUID(),requestIdHeader:false});
 const repository=(request:FastifyRequest)=>repo??createRepository(config,diagnostic=>request.log.warn(diagnostic,'Supabase request failed'));
 app.addHook('onRequest',async(request,reply)=>{reply.header('x-request-id',request.id);
  reply.header('Cache-Control','no-store');
  reply.header('X-Content-Type-Options','nosniff');
  reply.header('Referrer-Policy','no-referrer');
  reply.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");});
 app.addHook('onResponse',async(request,reply)=>{request.log.info({event:'http_request',method:request.method,route:request.routeOptions.url??'unmatched',statusCode:reply.statusCode,durationMs:Math.round(reply.elapsedTime)},'Request completed');});
 await app.register(cors,{origin:config.WEB_ORIGIN,methods:['GET','POST','PUT','OPTIONS'],allowedHeaders:['Authorization','Content-Type','Idempotency-Key'],exposedHeaders:['X-Request-Id']});
 app.setErrorHandler((error,request,reply)=>{
  const code=error instanceof ApiError?error.code:error instanceof ZodError?'INVALID_INPUT':'INTERNAL_ERROR';
  request.log.warn({event:'request_failed',code,method:request.method,route:request.routeOptions.url??'unmatched'},'Request failed');
  if(error instanceof ZodError)return reply.code(400).send({code:'INVALID_INPUT',message:'Check the event fields and try again.',requestId:request.id});
  if(error instanceof ApiError)return reply.code(error.status).send({code:error.code,message:error.message,requestId:request.id});
  if(error && typeof error==='object' && 'statusCode'in error && error.statusCode===413)return reply.code(413).send({code:'PAYLOAD_TOO_LARGE',message:'This event is too large to save.',requestId:request.id});
  return reply.code(500).send({code:'INTERNAL_ERROR',message:'Something went wrong. Your local edits have not been discarded.',requestId:request.id});
 });
 app.get('/health',async()=>({status:'ok'}));
 app.register(async secured=>{
  secured.addHook('preHandler',async request=>{
   const authorization=request.headers.authorization;
   if(!authorization?.startsWith('Bearer ')||authorization.length>8192)throw new ApiError(401,'UNAUTHORIZED','Sign in to use your saved workspace.');
   await repository(request).user(authorization.slice(7));
  });
  registerAiRoutes(secured,config,repository,ai);
  registerSourcingRoutes(secured,config,repository,directory);
  function token(authorization:string|undefined){return authorization!.slice(7);}
  secured.get('/api/events',async request=>({events:await repository(request).list(token(request.headers.authorization))}));
  secured.get('/api/events/:id',async request=>{
   const {id}=z.object({id:z.uuid()}).parse(request.params);
   const event=await repository(request).get(token(request.headers.authorization),id);
   if(!event)throw new ApiError(404,'NOT_FOUND','Event not found.');
   return {event};
  });
  secured.post('/api/events',async(request,reply)=>{
   const input=createEventInput.parse(request.body);
   const operationId=z.uuid().parse(request.headers['idempotency-key']);
   const id=operationId;
   const groupId=(index:number)=>{const h=createHash('sha256').update(id+':group:'+index).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
   const plan:EventPlan={...input,id,pending:0,revision:0,
    color:input.kind==='Club celebration'?'cobalt':input.kind==='Workshop & technical talk'?'lavender':'peach',
    groups:[{id:groupId(0),name:'Space & essentials'},{id:groupId(1),name:'The experience'},{id:groupId(2),name:'People & publicity'}],
    tasks:[],budget:[],resources:[],agenda:[]};
   const saved=await repository(request).write(token(request.headers.authorization),plan,-1,operationId);
   return reply.code(201).send({event:saved});
  });
  secured.put('/api/events/:id',async request=>{
   const {id}=z.object({id:z.uuid()}).parse(request.params);
   const input=saveEventInput.parse(request.body);
   if(input.plan.id!==id||input.plan.revision!==input.expectedRevision+1)throw new ApiError(400,'INVALID_REVISION','The save does not match this event revision.');
   return {event:await repository(request).write(token(request.headers.authorization),input.plan,input.expectedRevision,input.operationId)};
  });
 });
 return app;
}


