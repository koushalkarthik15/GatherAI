import { NumberInput } from '../components/NumberInput';
import { useState } from 'react';
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import { applyProposal, formatMoney, proposeDemoBudget, type Proposal } from '@gather/core';
import { Drawer } from '../components/Dialog';
import type { Studio } from '../state/useStudio';
export function Revision({studio,open,onClose}: {studio:Studio;open:boolean;onClose:()=>void}) {
 const {event}=studio;
 const [amount,setAmount]=useState(String(Math.max(0,event.confirmed/100-5000)));
 const [proposal,setProposal]=useState<Proposal|null>(null);
 const [error,setError]=useState('');
 const stale=proposal&&proposal.baseRevision!==event.revision;
 return <Drawer title="A change of plans?" description="Explore a smaller budget. See the trade-offs before making anything official." open={open} onClose={onClose}>
  <div className="demo-notice"><Sparkles size={18}/><div><strong>Simulated proposal · no AI call</strong><p>This preview uses proportional arithmetic. It does not assess vendor prices, quality or whether reduced allocations are realistic.</p></div></div>
  <form className="form-stack" onSubmit={e=>{e.preventDefault();try{setProposal(proposeDemoBudget(event,Math.round(Number(amount)*100)));setError('');}catch{setError('Enter a valid nonnegative amount, up to ₹1,00,00,000.');}}}>
   <label>New confirmed funds · INR<NumberInput min={0} max={10000000} step="0.01" required value={amount} onValueChange={value=>{setAmount(value);setProposal(null);}}/></label>
   <p className="fine-print">Spending limit stays at {formatMoney(event.limit)}. Pending funding is excluded.</p>
   <button className="button primary">Preview adjustment<ArrowRight size={16}/></button>
  </form>
  {error&&<p role="alert" className="error-box">{error}</p>}
  {proposal&&<div className="proposal"><div className="eyebrow">BEFORE YOU MAKE IT OFFICIAL</div><h3>{proposal.conflict?'A commitment needs attention.':'One possible way forward.'}</h3>
   <div className="proposal-summary"><div><span>Current funds</span><strong>{formatMoney(event.confirmed)}</strong></div><ArrowRight size={20}/><div><span>Proposed funds</span><strong>{formatMoney(proposal.confirmed)}</strong></div></div>
   <p className="muted">{proposal.reason}</p>
   {proposal.budget.map(item=>{const before=event.budget.find(b=>b.id===item.id);return <div className="diff-row" key={item.id}><div><strong>{item.name}</strong><span className="table-subtitle">{item.committed?<><LockKeyhole size={11}/> Protected</>:item.estimate!==before?.estimate?'Changed · flexible estimate':'Unchanged'}</span></div><div><span className={item.estimate!==before?.estimate?'old-value':''}>{formatMoney(before?.estimate??0)}</span>{item.estimate!==before?.estimate&&<strong>{formatMoney(item.estimate)}</strong>}</div></div>;})}
   <div className="quiet-note"><LockKeyhole size={16}/><p>Tasks, notes, completion status, and actual spending stay intact. No procurement task changes are simulated.</p></div>
   {(proposal.conflict||stale)&&<p role="alert" className="error-box">{proposal.conflict||'The plan changed while reviewing. Generate a fresh preview.'}</p>}
   <div className="drawer-actions"><button className="button primary" disabled={Boolean(proposal.conflict||stale)} onClick={()=>{try{studio.apply(applyProposal(event,proposal));onClose();}catch(e){setError(e instanceof Error?e.message:'Could not apply.');}}}>Apply demo changes<ArrowRight size={16}/></button><button className="button secondary" onClick={onClose}>Discard</button></div>
  </div>}
 </Drawer>;
}
