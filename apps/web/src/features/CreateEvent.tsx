import { NumberInput } from '../components/NumberInput';
import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { createEventInput, type CreateEventInput } from '@gather/core/cloud';
import { Drawer } from '../components/Dialog';
import { BriefFields } from './EventBrief';
export function CreateEvent({onClose,onCreate}:{
 onClose:()=>void;onCreate:(input:CreateEventInput,operationId:string)=>Promise<void>;
}){
 const [input,setInput]=useState<CreateEventInput>({name:'',description:'',kind:'Club celebration',date:'',location:'',guests:50,confirmed:0,limit:0});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const operationId=useRef(crypto.randomUUID());
 const retryInput=useRef<CreateEventInput|null>(null);
 return <Drawer title="Make room for a gathering." description="Create an empty saved plan. Add tasks and budget items directly, or review an AI starting plan before adding your own items." open onClose={()=>{if(!busy)onClose();}}>
  <form className="form-stack" onSubmit={async event=>{
   event.preventDefault();if(busy)return;
   const result=createEventInput.safeParse(input);
   if(!result.success){setError(result.error.issues[0]?.message??'Check the event details.');return;}
   if(retryInput.current&&JSON.stringify(retryInput.current)!==JSON.stringify(result.data))operationId.current=crypto.randomUUID();
   retryInput.current=result.data;
   setBusy(true);setError('');
   try{await onCreate(result.data,operationId.current);onClose();}
   catch(error){setError(error instanceof Error?error.message:'Could not create event.');}
   finally{setBusy(false);}
  }}>
   <label>Event name<input required maxLength={160} value={input.name} disabled={busy} onChange={e=>setInput({...input,name:e.target.value})}/></label>
   <label>Event type<select value={input.kind} disabled={busy} onChange={e=>setInput({...input,kind:e.target.value as CreateEventInput['kind']})}>{['Club celebration','Workshop & technical talk','Community gathering'].map(kind=><option key={kind}>{kind}</option>)}</select></label>
   <label>Purpose and audience<textarea required rows={3} maxLength={2000} value={input.description} disabled={busy} onChange={e=>setInput({...input,description:e.target.value})}/></label>
   <div className="field-pair"><label>Date<input type="date" required value={input.date} disabled={busy} onChange={e=>setInput({...input,date:e.target.value})}/></label><label>Expected guests<NumberInput required min={1} max={100000} value={input.guests} disabled={busy} onValueChange={value=>setInput({...input,guests:Number(value)})}/></label></div>
   <label>Venue or setting<input required placeholder="Venue, online, or location to be confirmed" maxLength={200} value={input.location} disabled={busy} onChange={e=>setInput({...input,location:e.target.value})}/></label>
   <div className="field-pair"><label>Confirmed funds · INR<NumberInput required min={0} max={10000000} step=".01" value={input.confirmed/100} disabled={busy} onValueChange={value=>setInput({...input,confirmed:Math.round(Number(value)*100)})}/></label><label>Spending limit · INR<NumberInput required min={0} max={10000000} step=".01" value={input.limit/100} disabled={busy} onValueChange={value=>setInput({...input,limit:Math.round(Number(value)*100)})}/></label></div>
   <details><summary>More event details (optional)</summary><p className="muted">These details are shared with the AI provider if you generate a plan. Avoid sensitive personal information.</p><BriefFields value={input.brief??{}} disabled={busy} onChange={brief=>setInput({...input,brief})}/></details>
   {error&&<p role="alert" className="error-box">{error}</p>}
   <button className="button primary" disabled={busy}>{busy?'Creating...':'Create saved event'}<ArrowRight size={16}/></button>
  </form>
 </Drawer>;
}
