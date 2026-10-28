import { NumberInput } from '../components/NumberInput';
import { useState } from 'react';
import { Check, LockKeyhole, Pencil, Plus } from 'lucide-react';
import { formatMoney, totals, type BudgetItem } from '@gather/core';
import { Funding } from '../components/Funding';
import { FundingScenario } from './FundingScenario';
import { Allocation } from '../components/Allocation';
import { Drawer } from '../components/Dialog';
import type { Studio } from '../state/useStudio';
export function Budget({studio,userId,blocked=false,onRefresh}: {studio:Studio;userId?:string;blocked?:boolean;onRefresh?:()=>Promise<void>}) {
 const {event,update}=studio;
 const [editing,setEditing]=useState<BudgetItem|null>(null);
 const [fresh,setFresh]=useState(false);
 const [error,setError]=useState('');
 const [scenarioOpen,setScenarioOpen]=useState(false);
 const [selectedCategory,setSelectedCategory]=useState<string|null>(null);
 const {estimate}=totals(event);
 return <><Funding event={event}/><section className="panel budget-panel"><div className="section-heading"><div><h2>Where the good things go.</h2><p className="muted">A thoughtful plan for every rupee.</p></div><button className="button secondary" onClick={()=>{setError('');setEditing({id:crypto.randomUUID(),name:'',category:'Other',estimate:0,actual:0,committed:false});setFresh(true);}}><Plus size={15}/>Add item</button></div>
  <button className="button secondary" onClick={()=>setScenarioOpen(true)}>Preview funding change</button><Allocation event={event} selected={selectedCategory} onSelect={setSelectedCategory}/>
  <div className="table-scroll"><table><thead><tr><th>ITEM / CATEGORY</th><th>COMMITMENT</th><th>ACTUAL SPEND</th><th>ESTIMATE</th><th><span className="sr-only">Edit</span></th></tr></thead><tbody>{event.budget.map(item=><tr key={item.id} className={selectedCategory === (item.category || 'Other') ? 'category-highlight' : ''}><td><strong>{item.name}</strong><span className="table-subtitle">{item.category}</span></td><td><span className={'pill '+(item.committed?'locked':'')}>{item.committed&&<LockKeyhole size={12}/>} {item.committed?'Committed':'Flexible'}</span></td><td>{formatMoney(item.actual)}</td><td><strong>{formatMoney(item.estimate)}</strong></td><td><button className="icon-button" onClick={()=>{setError('');setEditing({...item});setFresh(false);}} aria-label={'Edit '+item.name}><Pencil size={15}/></button></td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Total estimated spend</th><td><strong>{formatMoney(estimate)}</strong></td><td/></tr></tfoot></table></div>
  <div className="quiet-note"><LockKeyhole size={16}/><p>Committed costs and recorded spending stay protected in revision previews. All prices here are illustrative estimates.</p></div>
 </section>
 {scenarioOpen&&<FundingScenario key={event.id} event={event} userId={userId} blocked={blocked} onRefresh={onRefresh} onClose={()=>setScenarioOpen(false)}/>}
 <Drawer title={fresh?'Make room for something.':'A little adjustment.'} description="Direct edits use no AI. Changing a commitment here is an explicit organizer decision." open={Boolean(editing)} onClose={()=>setEditing(null)}>
 {editing&&<form className="form-stack" onSubmit={ev=>{ev.preventDefault();if(!editing.name.trim())return;if(update({...event,budget:fresh?[...event.budget,{...editing,name:editing.name.trim()}]:event.budget.map(b=>b.id===editing.id?{...editing,name:editing.name.trim()}:b)},'Budget saved.')){setError('');setEditing(null);}else setError('Could not save this item. Check the event item limits and other fields.');}}>
 <label>Item name<input required value={editing.name} maxLength={120} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
 <label>Category<input value={editing.category} maxLength={80} onChange={e=>setEditing({...editing,category:e.target.value})}/></label>
 <div className="field-pair"><label>Estimate · INR<NumberInput min={0} max={10000000} step="0.01" value={editing.estimate/100} onValueChange={value=>setEditing({...editing,estimate:Math.round(Number(value)*100)})} required/></label><label>Actual spend · INR<NumberInput min={0} max={10000000} step="0.01" value={editing.actual/100} onValueChange={value=>setEditing({...editing,actual:Math.round(Number(value)*100)})} required/></label></div>
 <label className="checkbox-label"><input type="checkbox" checked={editing.committed} onChange={e=>setEditing({...editing,committed:e.target.checked})}/>Protect as a committed cost</label>
 {error&&<p role="alert" className="error-box">{error}</p>}<button className="button primary">Save item<Check size={16}/></button>
 </form>}
 </Drawer></>;
}
