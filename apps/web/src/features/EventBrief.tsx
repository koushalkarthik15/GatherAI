import { useState } from 'react';
import { eventBriefSchema, type EventBrief } from '@gather/core';
import { Drawer } from '../components/Dialog';
import { NumberInput } from '../components/NumberInput';
import type { Studio } from '../state/useStudio';

export function BriefFields({value,onChange,disabled=false}:{value:EventBrief;onChange:(value:EventBrief)=>void;disabled?:boolean}) {
 return <div className="form-stack">
  <label>Event duration in minutes <span className="muted">(optional)</span><NumberInput min={1} max={1440} step={1} value={value.durationMinutes??''} disabled={disabled} onValueChange={v=>onChange({...value,durationMinutes:v===''?undefined:Number(v)})}/></label>
  <label>Resources already available<textarea rows={2} maxLength={400} value={value.availableResources??''} disabled={disabled} onChange={e=>onChange({...value,availableResources:e.target.value})} placeholder="For example, chairs offered by the college"/></label>
  <label>Must-haves<textarea rows={2} maxLength={400} value={value.mustHaves??''} disabled={disabled} onChange={e=>onChange({...value,mustHaves:e.target.value})}/></label>
  <label>Accessibility needs<textarea rows={2} maxLength={400} value={value.accessibility??''} disabled={disabled} onChange={e=>onChange({...value,accessibility:e.target.value})}/></label>
  <label>Known cost notes<textarea rows={2} maxLength={400} value={value.knownCosts??''} disabled={disabled} onChange={e=>onChange({...value,knownCosts:e.target.value})} placeholder="For example, a venue quoted INR 5,000"/></label>
 </div>;
}

export function EventBriefEditor({studio,onClose}:{studio:Studio;onClose:()=>void}) {
 const [value,setValue]=useState<EventBrief>(studio.event.brief??{});
 const [error,setError]=useState('');
 return <Drawer open onClose={onClose} title="Event details" description="Add what you know so a starting plan can reflect your event. All fields are optional.">
  <form className="form-stack" onSubmit={e=>{
   e.preventDefault();
   const parsed=eventBriefSchema.safeParse(value);
   if(!parsed.success){setError('Check the duration and field lengths.');return;}
   if(studio.update({...studio.event,brief:parsed.data},'Event details updated.'))onClose();
   else setError('Could not save these details. Check the event item limits and other fields.');
  }}>
   <p className="muted">If you generate an AI plan, these details are sent to the AI provider. Avoid sensitive personal information. Cost notes are context; record actual spending and commitments in Budget.</p>
   <BriefFields value={value} onChange={setValue}/>
   {error&&<p className="error-box" role="alert">{error}</p>}
   <button className="button primary">Save details</button>
  </form>
 </Drawer>;
}