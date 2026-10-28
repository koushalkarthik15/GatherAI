import { useEffect, useState } from 'react';
import { formatMoney, totals } from '@gather/core';
import { isEmptyPlan, type SavedProposal } from '@gather/core/generation';
import { Drawer } from '../components/Dialog';
import { cloudApi } from '../cloud/api';
import type { Studio } from '../state/useStudio';

export function AiPlanning({userId,studio,blocked,onClose,onApplied}:{
 userId:string;studio:Studio;blocked:boolean;onClose:()=>void;onApplied:()=>Promise<void>;
}){
 const [api]=useState(()=>cloudApi(userId));
 const [proposals,setProposals]=useState<SavedProposal[]>([]);
 const [selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[enabled,setEnabled]=useState<boolean|null>(null);
 const [error,setError]=useState('');
 const {event}=studio;
 useEffect(()=>{
  let active=true;
  Promise.all([api.proposals(event.id),api.aiStatus()]).then(([items,status])=>{
   if(!active)return;setProposals(items);setSelected(items[0]?.id??'');setEnabled(status.enabled);
  }).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not open proposals.');})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[api,event.id]);
 const proposal=proposals.find(item=>item.id===selected);
 const stale=proposal&&proposal.baseRevision!==event.revision;
 async function refresh(){
  setBusy(true);setError('');
  try{const [items,status]=await Promise.all([api.proposals(event.id),api.aiStatus()]);setEnabled(status.enabled);setProposals(items);setSelected(id=>items.some(p=>p.id===id)?id:(items[0]?.id??''));}
  catch(error){setError(error instanceof Error?error.message:'Could not load proposals.');}
  finally{setBusy(false);}
 }
 async function generate(){
  setBusy(true);setError('');
  try{
   const next=await api.generate(event.id,event.revision,crypto.randomUUID());
   setProposals(items=>[next,...items.filter(item=>item.id!==next.id)]);setSelected(next.id);
  }catch(error){setError(error instanceof Error?error.message:'Generation failed. Your event is unchanged.');}
  finally{setBusy(false);}
 }
 async function decide(action:'apply'|'discard'|'rollback'){
  if(!proposal||blocked)return;
  setBusy(true);setError('');
  try{
   const next=await api.decide(event.id,proposal.id,proposal.baseRevision,action);
   setProposals(items=>items.map(item=>item.id===next.id?next:item));
   if(action!=='discard')await onApplied();
  }catch(error){setError(error instanceof Error?error.message:'Could not update this proposal.');}
  finally{setBusy(false);}
 }
 return <Drawer open title="A thoughtful starting point." description="Generate suggested additions using your event details. Review them before applying; existing entries stay unchanged." onClose={()=>{if(!busy)onClose();}}>
  <div className="form-stack">
   <p className="fine-print">Your event details and some existing item names are sent to the configured AI provider, with the other provider available as fallback. Up to two provider attempts per request. Local limits: five requests per account and twenty across the project per UTC day, including failed requests.</p>
   {blocked&&<p role="status" className="error-box">Wait for all manual changes to save before generating, applying or rolling back.</p>}
   {enabled===false&&!loading&&<p className="error-box">AI is not configured. Check the provider keys and model names in apps/api/.env and restart the API.</p>}
   {!isEmptyPlan(event)&&<p className="fine-print">Existing entries stay unchanged. Suggestions are additions, not edits to existing items; check for duplicates and confirm all estimates.</p>}
   <div className="drawer-actions"><button className="button primary" disabled={busy||loading||blocked||!enabled} onClick={()=>void generate()}>{busy?'Working...':(isEmptyPlan(event)?'Generate a starting plan':'Suggest additions')}</button><button className="button secondary" disabled={busy} onClick={()=>void refresh()}>Reload proposals</button></div>
   {busy&&<p role="status">Working on your request. The saved event stays unchanged until you apply.</p>}
   {loading&&<p role="status">Opening saved proposals...</p>}
   {error&&<p role="alert" className="error-box">{error}</p>}
   {!!proposals.length&&<label>Saved proposals<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{proposals.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.status} — {item.summary||'Generation request'}</option>)}</select></label>}
   {proposal&&<section className="info-content">
    <p className="eyebrow">{proposal.status.toUpperCase()}</p>
    <h3>{proposal.summary||'Your generation request'}</h3>
    {!!proposal.provider&&<p className="fine-print">{proposal.provider} / {proposal.model} · {proposal.attempts} attempt(s)</p>}
    {proposal.status==='running'&&<p>Generation is in progress. Reopen this panel or reload proposals shortly. An abandoned request expires after two minutes.</p>}
    {proposal.status==='failed'&&<p>Generation did not complete. Your event was not changed. You can request another plan.</p>}
    {proposal.assumptions.length>0&&<><h3>Assumptions to confirm</h3><ul>{proposal.assumptions.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
    {proposal.plan&&<>
     <p className="fine-print">New suggestions are marked NEW. Existing entries remain unchanged.</p><h3>Budget</h3><p>Estimated {formatMoney(totals(proposal.plan).estimate)} / confirmed ceiling {formatMoney(totals(proposal.plan).ceiling)}. Prices are estimates; confirm them locally.</p>
     {proposal.plan.budget.map(item=><p key={item.id}>{!event.budget.some(existing=>existing.id===item.id)&&<strong>NEW </strong>}{item.name} ({item.category}): <strong>{formatMoney(item.estimate)}</strong></p>)}
     <h3>Preparation tasks</h3>{proposal.plan.groups.map(group=><div key={group.id}><strong>{group.name}</strong><ul>{proposal.plan!.tasks.filter(task=>task.groupId===group.id).map(task=><li key={task.id}>{!event.tasks.some(existing=>existing.id===task.id)&&<strong>NEW </strong>}{task.title} · {task.priority} · {task.due||'No deadline'}{task.notes&&<p>{task.notes}</p>}</li>)}</ul></div>)}
     <h3>Resources to arrange</h3>{proposal.plan.resources.map(item=><p key={item.id}>{!event.resources.some(existing=>existing.id===item.id)&&<strong>NEW </strong>}{item.name} — {item.source||'Source to confirm'}</p>)}
     <h3>Running order</h3>{proposal.plan.agenda.map(item=><p key={item.id}>{!event.agenda.some(existing=>existing.id===item.id)&&<strong>NEW </strong>}{item.time} — {item.title}</p>)}
    </>}
    {proposal.status==='ready'&&<>
     {stale&&<p role="alert" className="error-box">This event changed after generation. This proposal cannot be applied. Reload your saved event before generating a fresh plan.</p>}
     <div className="drawer-actions"><button className="button primary" disabled={busy||blocked||Boolean(stale)} onClick={()=>void decide('apply')}>Apply reviewed plan</button><button className="button secondary" disabled={busy||blocked} onClick={()=>void decide('discard')}>Discard</button></div>
    </>}
    {proposal.status==='applied'&&<><p className="fine-print">Rollback restores the plan before this generation and is available only while no later changes exist.</p><button className="button secondary" disabled={busy||blocked||event.revision!==proposal.appliedRevision} onClick={()=>void decide('rollback')}>Restore previous plan</button></>}
   </section>}
  </div>
 </Drawer>;
}
