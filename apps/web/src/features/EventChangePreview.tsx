import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { cloudPlanSchema } from '@gather/core/cloud';
import { supabase } from '../auth/client';
import { formatMoney, totals, type EventPlan } from '@gather/core';
import { planningMetadataSchema, previewAttendance, previewEventDate, type PlanningPreview } from '@gather/core/planning';
import { Drawer } from '../components/Dialog';
import { NumberInput } from '../components/NumberInput';

function localDate() {
 const d=new Date();
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
const proposalSchema=z.object({
 id:z.uuid(),event_id:z.uuid(),base_revision:z.number().int(),kind:z.enum(['attendance','date','venue']),value:z.string(),
 status:z.enum(['ready','applied','discarded','rolled_back']),applied_revision:z.number().int().nullable(),
 before_plan:cloudPlanSchema,proposed_plan:cloudPlanSchema,
});
type EventChangeProposal=z.infer<typeof proposalSchema>;
export function EventChangePreview({event,onClose,userId,blocked=false,onRefresh}:{event:EventPlan;onClose:()=>void;userId?:string;blocked?:boolean;onRefresh?:()=>Promise<void>}) {
 const [kind,setKind]=useState<'attendance'|'date'|'venue'>('attendance');
 const [guests,setGuests]=useState(String(event.guests));
 const [date,setDate]=useState(event.date);

 const [venue,setVenue]=useState(event.location);
 const [result,setResult]=useState<PlanningPreview|null>(null);
 const [error,setError]=useState('');
 const [proposals,setProposals]=useState<EventChangeProposal[]>([]);
 const [selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false);
 const retry=useRef<{id:string;revision:number;kind:string;value:string}|null>(null);
 async function call(action:string,id:string|null=null,revision:number|null=null,changeKind:string|null=null,value:string|null=null):Promise<unknown> {
  if(!supabase||!userId)throw new Error('Sign in to use saved proposals.');
  const {data:session}=await supabase.auth.getSession();
  if(session.session?.user.id!==userId)throw new Error('Your session changed. Sign in again.');
  const {data,error}=await supabase.rpc('event_change_action',{p_action:action,p_event:event.id,p_id:id,p_expected:revision,p_kind:changeKind,p_value:value});
  if(error)throw new Error(error.code==='40001'?'The event or proposal changed. Reload and review again.':'Could not update the proposal. Check your connection and retry.');
  return data;
 }
 async function load(){
  const items=proposalSchema.array().parse(await call('list'));
  setProposals(items);setSelected(id=>items.some(item=>item.id===id)?id:(items[0]?.id??''));
 }
 useEffect(()=>{
  let active=true;
  if(userId&&supabase)void supabase.rpc('event_change_action',{p_action:'list',p_event:event.id}).then(({data,error})=>{
   if(!active)return;
   const parsed=proposalSchema.array().safeParse(data);
   if(error||!parsed.success){setError('Could not load saved event proposals.');return;}
   setProposals(parsed.data);setSelected(parsed.data[0]?.id??'');
  });
  return()=>{active=false;};
 },[event.id,userId]);
 const proposal=proposals.find(item=>item.id===selected);
 async function saveProposal(){
  if(!result||blocked||busy||result.baseRevision!==event.revision)return;
  const value=kind==='attendance'?String(result.plan.guests):kind==='date'?result.plan.date:result.plan.location;
  if(!retry.current||retry.current.revision!==event.revision||retry.current.kind!==kind||retry.current.value!==value)
   retry.current={id:crypto.randomUUID(),revision:event.revision,kind,value};
  setBusy(true);setError('');
  try{const op=retry.current;const item=proposalSchema.parse(await call('create',op.id,op.revision,op.kind,op.value));setProposals(items=>[item,...items.filter(existing=>existing.id!==item.id)]);setSelected(item.id);retry.current=null;}
  catch(e){setError(e instanceof Error?e.message:'Could not save the proposal.');}finally{setBusy(false);}
 }
 async function decide(action:'apply'|'discard'|'rollback'){
  if(!proposal||blocked||busy)return;
  setBusy(true);setError('');
  try{const item=proposalSchema.parse(await call(action,proposal.id,proposal.base_revision));setProposals(items=>items.map(old=>old.id===item.id?item:old));if(action!=='discard')await onRefresh?.();setResult(null);}
  catch(e){setError(e instanceof Error?e.message:'Could not update the proposal.');}finally{setBusy(false);}
 }
 return <Drawer open onClose={onClose} title="Preview event changes" description="Compare a possible change with your current plan. Save a proposal and review it before applying any changes.">
  <form className="form-stack" onSubmit={e=>{
   e.preventDefault();
   try{
    const metadata=planningMetadataSchema.parse(event.planning??{});
        if(kind==='venue'){
     if(!venue.trim()||venue.trim().length>200)throw new Error('Invalid venue');
     const resources=venue.trim()===event.location?event.resources:event.resources.map(item=>item.status==='Confirmed'||item.status==='Requested'?{...item,status:'Reconfirmation needed' as const}:item);
     setResult({eventId:event.id,baseRevision:event.revision,plan:{...event,location:venue.trim(),resources},warnings:venue.trim()===event.location?[]:[{code:'RECONFIRM_BOOKING',message:'Confirm existing arrangements for the new venue.'}],conflicts:[]});
    }else setResult(kind==='attendance'?previewAttendance(event,metadata,Number(guests)):previewEventDate(event,metadata,date,localDate()));
    setError('');
   }catch{setError('Check the date, attendance, venue and saved planning rules.');}
  }}>
   <label>Change to explore<select value={kind} onChange={e=>{setKind(e.target.value as 'attendance'|'date'|'venue');setResult(null);}}><option value="attendance">Attendance</option><option value="date">Event date</option><option value="venue">Venue or location</option></select></label>
   {kind==='attendance'?<>
    <label>Expected guests<NumberInput required min={1} max={100000} step={1} value={guests} onValueChange={v=>{setGuests(v);setResult(null);}}/></label>
    <p className="fine-print">Venue capacity: {event.planning?.capacity??'not recorded'}. Set this in Planning rules.</p>
    <p className="fine-print">Per-attendee costs use the saved planning rules. Confirm quantities and staffing.</p>
   </>:kind==='date'?<>
    <label>Proposed event date<input type="date" required value={date} onChange={e=>{setDate(e.target.value);setResult(null);}}/></label>
    <p className="fine-print">Only unfinished deadlines marked event-relative move. Requested and confirmed resources are flagged for reconfirmation.</p>
   </>:<>
    <label>Proposed venue or location<input required maxLength={200} value={venue} onChange={e=>{setVenue(e.target.value);setResult(null);}}/></label>
    <p className="fine-print">Requested and confirmed resources are flagged for reconfirmation.</p>
   </>}
   <button className="button primary">Calculate preview</button>
   {error&&<p className="error-box" role="alert">{error}</p>}
  </form>
  {result&&<section className="proposal" aria-live="polite">
   <h3>Possible impact</h3>
   {result.baseRevision!==event.revision?<p className="error-box">Your event changed. Calculate again before relying on this preview.</p>:<>
    <p>{kind==='attendance'?'Guests: '+event.guests+' to '+result.plan.guests:kind==='date'?'Date: '+event.date+' to '+result.plan.date:'Venue: '+event.location+' to '+result.plan.location}</p>
    <p>Recorded cost exposure: {formatMoney(totals(result.plan).exposure)}. Missing costs may still arise.</p>
    {result.plan.budget.map(item=>{const before=event.budget.find(old=>old.id===item.id);return before&&before.estimate!==item.estimate?<p key={item.id}>Estimate - {item.name}: {formatMoney(before.estimate)} to {formatMoney(item.estimate)}.</p>:null;})}
    {result.plan.tasks.map(item=>{const before=event.tasks.find(old=>old.id===item.id);return before&&before.due!==item.due?<p key={item.id}>Deadline - {item.title}: {before.due||'none'} to {item.due||'none'}.</p>:null;})}
    {!!result.conflicts.length&&<p className="error-box">Recorded exposure exceeds the confirmed ceiling by {formatMoney(Math.max(0,-totals(result.plan).remaining))}.</p>}
    {!!result.warnings.length&&<ul>{result.warnings.map((warning,index)=><li key={index}>{warning.entityId?(event.tasks.find(t=>t.id===warning.entityId)?.title??event.resources.find(r=>r.id===warning.entityId)?.name??'Item')+': ':''}{warning.message}</li>)}</ul>}
    {!result.warnings.length&&<p>No change-specific warnings for these inputs. Unrecorded information remains unknown.</p>}
   </>}
   {userId?<button className="button secondary" disabled={busy||blocked||result.baseRevision!==event.revision} onClick={()=>void saveProposal()}>Save proposal for review</button>:<p className="fine-print">Sign in to save a proposal.</p>}
  </section>}
  {userId&&<section className="proposal">
   <h3>Saved event-change proposals</h3>
   {blocked&&<p role="status">Wait for manual edits to finish saving.</p>}
   <button className="text-button" disabled={busy} onClick={()=>{setBusy(true);void load().catch(()=>setError('Could not load proposals.')).finally(()=>setBusy(false));}}>Reload proposals</button>
   {proposals.length>0&&<label>Choose proposal<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{proposals.map(item=><option key={item.id} value={item.id}>{item.status} - {item.kind}: {item.value}</option>)}</select></label>}
   {proposal&&<>
    <p>{proposal.kind==='attendance'?'Guests: '+proposal.before_plan.guests+' to '+proposal.proposed_plan.guests:proposal.kind==='date'?'Date: '+proposal.before_plan.date+' to '+proposal.proposed_plan.date:'Venue: '+proposal.before_plan.location+' to '+proposal.proposed_plan.location}</p>
    {proposal.proposed_plan.resources.filter((item,index)=>item.status!==proposal.before_plan.resources[index]?.status).map(item=><p key={item.id}>{item.name}: reconfirmation needed.</p>)}
    {proposal.proposed_plan.budget.map(item=>{const before=proposal.before_plan.budget.find(old=>old.id===item.id);return before&&before.estimate!==item.estimate?<p key={item.id}>Estimate - {item.name}: {formatMoney(before.estimate)} to <strong>{formatMoney(item.estimate)}</strong>. Actual spending: {formatMoney(item.actual)}.</p>:null;})}
    {proposal.proposed_plan.tasks.map(item=>{const before=proposal.before_plan.tasks.find(old=>old.id===item.id);return before&&before.due!==item.due?<p key={item.id}>Deadline - {item.title}: {before.due||'none'} to <strong>{item.due||'none'}</strong>.</p>:null;})}
    {totals(proposal.proposed_plan).remaining<0&&<p className="error-box">Recorded exposure exceeds the confirmed ceiling by {formatMoney(-totals(proposal.proposed_plan).remaining)}. Applying leaves the event over budget.</p>}
    {proposal.kind==='attendance'&&proposal.before_plan.planning?.capacity!==undefined&&proposal.proposed_plan.guests>proposal.before_plan.planning.capacity&&<p className="error-box">Proposed attendance exceeds the saved venue capacity. Confirm capacity before applying.</p>}
    <p className="fine-print">Review the changed budget, deadlines and resource statuses before applying.</p>
    {proposal.status==='ready'&&<>
     {proposal.base_revision!==event.revision&&<p className="error-box">The event changed. Create a fresh proposal.</p>}
     <div className="drawer-actions"><button className="button primary" disabled={busy||blocked||proposal.base_revision!==event.revision} onClick={()=>void decide('apply')}>Apply reviewed change</button><button className="button secondary" disabled={busy||blocked} onClick={()=>void decide('discard')}>Discard</button></div>
    </>}
    {proposal.status==='applied'&&<button className="button secondary" disabled={busy||blocked||event.revision!==proposal.applied_revision} onClick={()=>void decide('rollback')}>Restore previous plan</button>}
   </>}
  </section>}
 </Drawer>;
}