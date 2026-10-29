import { z } from 'zod';
import { generatedPlanSchema } from '../../../../packages/core/src/generation.ts';
export type ProviderName='groq'|'gemini';
export type ProviderSettings={groqKey:string;geminiKey:string;groqModel:string;geminiModel:string;primary:ProviderName};
export class ProviderError extends Error{
 code:string;transient:boolean;
 constructor(code:string,transient=false){super(code);this.code=code;this.transient=transient;}
}
export type ProviderResult={value:unknown;provider:ProviderName;model:string;tokens:number|null};
export type ProviderCall=(provider:ProviderName,prompt:string)=>Promise<ProviderResult>;
const groqEnvelope=z.object({
 choices:z.array(z.object({message:z.object({content:z.string()}),finish_reason:z.string()})).min(1),
 usage:z.object({total_tokens:z.number().int().nonnegative()}).optional(),
});
const geminiEnvelope=z.object({
 candidates:z.array(z.object({
  content:z.object({parts:z.array(z.object({text:z.string().optional(),thought:z.boolean().optional()}))}),
  finishReason:z.string(),
 })).min(1),
 usageMetadata:z.object({totalTokenCount:z.number().int().nonnegative()}).optional(),
});
const schema=z.toJSONSchema(generatedPlanSchema);
delete schema.$schema;
export const MAX_OUTPUT_TOKENS=4096;
export const MAX_INPUT_BYTES=12000;
export function createProviderCall(settings:ProviderSettings,fetcher:typeof fetch=fetch):ProviderCall{
 return async(provider,prompt)=>{
  const key=provider==='groq'?settings.groqKey:settings.geminiKey;
  const model=provider==='groq'?settings.groqModel:settings.geminiModel;
  if(!key||!model)throw new ProviderError('AI_NOT_CONFIGURED');
  const groq=provider==='groq';
  const body=groq?{
   model,messages:[{role:'user',content:prompt}],max_completion_tokens:MAX_OUTPUT_TOKENS,
   response_format:{type:'json_schema',json_schema:{name:'event_plan',strict:true,schema}},
  }:{
   contents:[{role:'user',parts:[{text:prompt}]}],
   generationConfig:{maxOutputTokens:MAX_OUTPUT_TOKENS,responseMimeType:'application/json',responseJsonSchema:schema},
  };
  // Include structured schema overhead in the conservative request reservation.
  if(Buffer.byteLength(JSON.stringify(body),'utf8')>MAX_INPUT_BYTES)throw new ProviderError('AI_INPUT_TOO_LARGE');
  let response:Response;
  try{
   response=await fetcher(groq?'https://api.groq.com/openai/v1/chat/completions':
    'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
    method:'POST',headers:{'Content-Type':'application/json',...(groq?{Authorization:'Bearer '+key}:{'x-goog-api-key':key})},
    body:JSON.stringify(body),signal:AbortSignal.timeout(20000),
   });
  }catch{throw new ProviderError('AI_NETWORK_OR_TIMEOUT',true);}
  if(!response.ok){
   // Never log or forward provider payloads, headers or key-bearing URLs.
   void response.body?.cancel();
   throw new ProviderError(response.status===401||response.status===403?'AI_PROVIDER_AUTH':
    response.status===429?'AI_RATE_LIMIT':response.status>=500?'AI_PROVIDER_UNAVAILABLE':'AI_PROVIDER_CONFIG',
    response.status===429||response.status===408||response.status>=500);
  }
  let json:unknown;
  try{
   const reader=response.body?.getReader();
   if(!reader)throw new Error();
   let size=0;const chunks:Uint8Array[]=[];
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>131072){await reader.cancel();throw new Error();}chunks.push(part.value);}
   json=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw new ProviderError('AI_INVALID_OUTPUT');}
  try{
   if(groq){
    const result=groqEnvelope.parse(json),first=result.choices[0];
    if(first.finish_reason!=='stop')throw new Error();
    return {value:JSON.parse(first.message.content),provider,model,tokens:result.usage?.total_tokens??null};
   }
   const result=geminiEnvelope.parse(json),first=result.candidates[0];
   if(first.finishReason!=='STOP')throw new Error();
   return {value:JSON.parse(first.content.parts.filter(p=>!p.thought).map(p=>p.text??'').join('')),
    provider,model,tokens:result.usageMetadata?.totalTokenCount??null};
  }catch{throw new ProviderError('AI_INVALID_OUTPUT');}
 };
}
