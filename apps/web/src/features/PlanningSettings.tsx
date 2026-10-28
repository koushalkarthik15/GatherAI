import { useState } from 'react';
import { planningMetadataSchema, type PlanningMetadata } from '@gather/core/planning';
import { Drawer } from '../components/Dialog';
import { NumberInput } from '../components/NumberInput';
import type { Studio } from '../state/useStudio';

export function PlanningSettings({studio,onClose}:{studio:Studio;onClose:()=>void}) {
 const {event}=studio;
 const [metadata,setMetadata]=useState<PlanningMetadata>(()=>planningMetadataSchema.parse(event.planning??{}));
 const [capacity,setCapacity]=useState(metadata.capacity===undefined?'':String(metadata.capacity));
 const [error,setError]=useState('');
 return <Drawer open onClose={onClose} title="Planning rules" description="Record known rules so change previews can calculate their effects. Unspecified items stay unchanged.">
  <form className="form-stack" onSubmit={e=>{
   e.preventDefault();
   const parsed=planningMetadataSchema.safeParse({...metadata,capacity:capacity?Number(capacity):undefined});
   if(!parsed.success){setError('Check the capacity and unit costs.');return;}
   if(studio.update({...event,planning:parsed.data},'Planning rules saved.'))onClose();
   else setError('Could not save these rules. Check the event item limits and other fields.');
  }}>
   <label>Known venue capacity (optional)<NumberInput min={1} max={100000} step={1} value={capacity} onValueChange={setCapacity}/></label>
   <h3>Per-attendee budget items</h3>
   <p className="fine-print">Set only when you know the unit cost. Committed items and actual spending remain protected.</p>
   {event.budget.length===0&&<p>No budget items recorded.</p>}
   {event.budget.map(item=>{
    const entry=metadata.budget.find(rule=>rule.id===item.id);
    const per=entry?.basis==='per_attendee';
    return <div key={item.id}>
     <label className="checkbox-label"><input type="checkbox" checked={per} onChange={e=>{
      const rest=metadata.budget.filter(rule=>rule.id!==item.id);
      setMetadata({...metadata,budget:e.target.checked?[...rest,{id:item.id,basis:'per_attendee',unitCost:0}]:rest});
     }}/>{item.name}</label>
     {per&&<label>Cost per attendee - INR<NumberInput required min={0} max={10000000} step=".01" value={entry.unitCost/100} onValueChange={value=>setMetadata({...metadata,budget:metadata.budget.map(rule=>rule.id===item.id&&rule.basis==='per_attendee'?{...rule,unitCost:Math.round(Number(value)*100)}:rule)})}/></label>}
    </div>;
   })}
   <h3>Event-relative deadlines</h3>
   <p className="fine-print">Only unfinished tasks explicitly selected here shift when the event date changes. Other deadlines remain fixed.</p>
   {event.tasks.length===0&&<p>No tasks recorded.</p>}
   {event.tasks.map(item=><label className="checkbox-label" key={item.id}><input type="checkbox" checked={metadata.tasks.some(rule=>rule.id===item.id&&rule.deadlineMode==='event_relative')} onChange={e=>{
    const rest=metadata.tasks.filter(rule=>rule.id!==item.id);
    setMetadata({...metadata,tasks:e.target.checked?[...rest,{id:item.id,deadlineMode:'event_relative'}]:rest});
   }}/>{item.title}</label>)}
   {error&&<p role="alert" className="error-box">{error}</p>}
   <button className="button primary">Save planning rules</button>
  </form>
 </Drawer>;
}