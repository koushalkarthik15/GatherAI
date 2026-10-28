import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { supabase } from '../auth/client';
import { formatMoney, previewFunding, type EventPlan } from '@gather/core';
import { Drawer } from '../components/Dialog';
import { NumberInput } from '../components/NumberInput';

const proposalSchema=z.object({
 id:z.uuid(),event_id:z.uuid(),base_revision:z.number().int(),old_confirmed:z.number(),old_limit:z.number(),
 new_confirmed:z.number(),new_limit:z.number(),status:z.enum(['ready','applied','discarded','rolled_back']),
 applied_revision:z.number().int().nullable(),
});
type FundingProposal=z.infer<typeof proposalSchema>;

export function FundingScenario({event,onClose,userId,blocked=false,onRefresh}:{event:EventPlan;onClose:()=>void;userId?:string;blocked?:boolean;onRefresh?:()=>Promise<void>}) {
 const [confirmed,setConfirmed]=useState(String(event.confirmed/100));
 const [limit,setLimit]=useState(String(event.limit/100));
 const [scenario,setScenario]=useState<ReturnType<typeof previewFunding>|null>(null);
 const [revision,setRevision]=useState(event.revision);
 const [error,setError]=useState('');
 const [proposals,setProposals]=useState<FundingProposal[]>([]);
 const [selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false);
 const retry=useRef<{id:string;confirmed:number;limit:number;revision:number}|null>(null);
 async function call(action:string,id:string|null=null,expected:number|null=null,amount:number|null=null,spendingLimit:number|null=null):Promise<unknown> {
  if(!supabase||!userId)throw new Error('Sign in to use saved funding proposals.');
  const {data:session}=await supabase.auth.getSession();
  if(session.session?.user.id!==userId)throw new Error('Your session changed. Sign in again.');
  const {data,error}=await supabase.rpc('funding_proposal_action',{p_action:action,p_event:event.id,p_id:id,p_expected:expected,p_confirmed:amount,p_limit:spendingLimit});
  if(error)throw new Error(error.code==='40001'?'The event or proposal changed. Reload the event before retrying.':'Funding proposal could not be saved or updated. Please retry.');
  return data;
 }
 async function load() {
  const items=proposalSchema.array().parse(await call('list'));
  setProposals(items);setSelected(id=>items.some(item=>item.id===id)?id:(items[0]?.id??''));
 }
 useEffect(()=>{
  let active=true;
  if(userId&&supabase) {
   void supabase.rpc('funding_proposal_action',{p_action:'list',p_event:event.id}).then(({data,error})=>{
    if(!active)return;
    if(error){setError('Could not load saved funding proposals.');return;}
    const parsed=proposalSchema.array().safeParse(data);
    if(!parsed.success){setError('Could not read saved funding proposals.');return;}
    setProposals(parsed.data);setSelected(parsed.data[0]?.id??'');
   });
  }
  return()=>{active=false;};
 },[event.id,userId]);
 const proposal=proposals.find(item=>item.id===selected);
 async function saveProposal() {
  if(!scenario||blocked||busy||event.revision!==revision)return;
  if(!retry.current||retry.current.confirmed!==scenario.confirmed||retry.current.limit!==scenario.limit||retry.current.revision!==revision)
   retry.current={id:crypto.randomUUID(),confirmed:scenario.confirmed,limit:scenario.limit,revision};
  setBusy(true);setError('');
  try{
   const op=retry.current;
   const item=proposalSchema.parse(await call('create',op.id,op.revision,op.confirmed,op.limit));
   setProposals(items=>[item,...items.filter(existing=>existing.id!==item.id)]);setSelected(item.id);retry.current=null;
  }catch(e){setError(e instanceof Error?e.message:'Could not save proposal.');}
  finally{setBusy(false);}
 }
 async function decide(action:'apply'|'discard'|'rollback') {
  if(!proposal||busy||blocked)return;
  setBusy(true);setError('');
  try{
   const item=proposalSchema.parse(await call(action,proposal.id,proposal.base_revision));
   setProposals(items=>items.map(existing=>existing.id===item.id?item:existing));
   if(action!=='discard')await onRefresh?.();
   setScenario(null);
  }catch(e){setError(e instanceof Error?e.message:'Could not update proposal.');}
  finally{setBusy(false);}
 }
 return <Drawer open onClose={onClose} title="Preview a funding change" description="Explore the effect of different confirmed funds and spending limits. Preview first, then save a proposal for review. Applying is a separate action.">
  <form className="form-stack" onSubmit={e=>{
   e.preventDefault();
   try {
    if(confirmed===''||limit==='')throw new Error('Enter both amounts.');
    const result=previewFunding(event,Math.round(Number(confirmed)*100),Math.round(Number(limit)*100));
    setScenario(result);setRevision(event.revision);setError('');
   }catch {setError('Enter both amounts from INR 0 to INR 1,00,00,000.');}
  }}>
   <label>Confirmed funds - INR<NumberInput required min={0} max={10000000} step="0.01" value={confirmed} onValueChange={value=>{setConfirmed(value);setScenario(null);}}/></label>
   <label>Spending limit - INR<NumberInput required min={0} max={10000000} step="0.01" value={limit} onValueChange={value=>{setLimit(value);setScenario(null);}}/></label>
   <p className="fine-print">Pending funds of {formatMoney(event.pending)} are excluded. Existing estimates, actual spending and commitments are unchanged.</p>
   <button className="button primary">Calculate preview</button>
   {error&&<p className="error-box" role="alert">{error}</p>}
  </form>
  {scenario&&<section className="proposal" aria-live="polite">
   <h3>Impact on your recorded budget</h3>
   {event.revision!==revision?<p className="error-box" role="alert">Your event changed. Calculate the preview again using the latest figures.</p>:<>
    <p>Current ceiling: <strong>{formatMoney(scenario.current.ceiling)}</strong></p>
    <p>Proposed ceiling: <strong>{formatMoney(scenario.ceiling)}</strong></p>
    <p>Recorded exposure: <strong>{formatMoney(scenario.exposure)}</strong> (the higher of estimate or actual for each item).</p>
    <p>Protected costs: <strong>{formatMoney(scenario.protectedCost)}</strong> (committed estimates or actual spending).</p>
    <p>{scenario.remaining<0?<>Recorded exposure exceeds the proposed ceiling by <strong>{formatMoney(-scenario.remaining)}</strong>.</>:<>Room after recorded exposure: <strong>{formatMoney(scenario.remaining)}</strong>. Unrecorded costs may still arise.</>}</p>
    {scenario.protectedCost>scenario.ceiling&&<p className="error-box">Protected costs alone exceed the proposed ceiling. Review funding or commitments before making changes.</p>}
    {event.budget.length===0&&<p className="fine-print">No budget items are recorded, so total event costs are unknown.</p>}
   </>}
   {userId?<button className="button secondary" disabled={busy||blocked||event.revision!==revision} onClick={()=>void saveProposal()}>Save proposal for review</button>:<p className="fine-print">Sign in to save a funding proposal.</p>}
  </section>}
  {userId&&<section className="proposal">
   <h3>Saved funding proposals</h3>
   {blocked&&<p role="status">Wait for manual changes to save before updating a proposal.</p>}
   <button className="text-button" disabled={busy} onClick={()=>{setBusy(true);setError('');void load().catch(()=>setError('Could not load saved funding proposals.')).finally(()=>setBusy(false));}}>Reload proposals</button>
   {proposals.length>0&&<label>Choose proposal<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{proposals.map(item=><option key={item.id} value={item.id}>{item.status} - {formatMoney(item.new_confirmed)} confirmed / {formatMoney(item.new_limit)} limit</option>)}</select></label>}
   {proposal&&<>
    <p>Confirmed funds: {formatMoney(proposal.old_confirmed)} to <strong>{formatMoney(proposal.new_confirmed)}</strong>.</p>
    <p>Spending limit: {formatMoney(proposal.old_limit)} to <strong>{formatMoney(proposal.new_limit)}</strong>.</p>
    {proposal.status==='ready'&&<>
     {event.revision!==proposal.base_revision&&<p className="error-box">The event changed after this proposal. Calculate and save a new proposal.</p>}
     {Math.min(proposal.new_confirmed,proposal.new_limit)<previewFunding(event,proposal.new_confirmed,proposal.new_limit).exposure&&<p className="error-box">Recorded exposure exceeds the proposed ceiling. Applying will leave the event over budget.</p>}
     <div className="drawer-actions"><button className="button primary" disabled={busy||blocked||event.revision!==proposal.base_revision} onClick={()=>void decide('apply')}>Apply reviewed funding</button><button className="button secondary" disabled={busy||blocked} onClick={()=>void decide('discard')}>Discard proposal</button></div>
    </>}
    {proposal.status==='applied'&&<><p className="fine-print">Restore is available only until another edit is saved.</p><button className="button secondary" disabled={busy||blocked||event.revision!==proposal.applied_revision} onClick={()=>void decide('rollback')}>Restore previous funding</button></>}
   </>}
  </section>}
 </Drawer>;
}