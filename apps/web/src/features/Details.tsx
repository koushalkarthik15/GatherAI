import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Drawer } from '../components/Dialog';
import type { EventPlan } from '@gather/core';
import type { Studio } from '../state/useStudio';

export function Schedule({studio}:{studio:Studio}) {
 const {event,update}=studio;
 const [editing,setEditing]=useState<EventPlan['agenda'][number]|null>(null);
 const [fresh,setFresh]=useState(false);
 const [error,setError]=useState('');
 return <section className="panel"><div className="section-heading"><div><h2>Let the day unfold.</h2><p className="muted">A little structure. Space for the unexpected.</p></div><button className="button secondary" onClick={()=>{setError('');setEditing({id:crypto.randomUUID(),time:'18:30',title:'',owner:''});setFresh(true);}}><Plus size={15}/>Add activity</button></div>
  <div className="schedule-list">{[...event.agenda].sort((a,b)=>a.time.localeCompare(b.time)).map(item=><div className="schedule-row" key={item.id}><time>{item.time}</time><span className="timeline-dot"/><button className="schedule-title" onClick={()=>{setError('');setEditing({...item});setFresh(false);}}><strong>{item.title}</strong><span>{item.owner||'Unassigned'}</span></button><button className="icon-button" aria-label={'Delete '+item.title} onClick={()=>update({...event,agenda:event.agenda.filter(a=>a.id!==item.id)},'Activity removed.')}><Trash2 size={16}/></button></div>)}</div>
  {!event.agenda.length&&<p className="empty-state">The day is yours to shape. Add your first activity.</p>}
  <Drawer title="Give the moment a place." description="Edit the running order. Times are local to the event." open={Boolean(editing)} onClose={()=>setEditing(null)}>{editing&&<form className="form-stack" onSubmit={e=>{e.preventDefault();if(!editing.title.trim())return;if(update({...event,agenda:fresh?[...event.agenda,editing]:event.agenda.map(a=>a.id===editing.id?editing:a)},'Running order saved.')){setError('');setEditing(null);}else setError('Could not save this activity. Check the event item limits and other fields.');}}><label>Activity<input required maxLength={160} value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/></label><div className="field-pair"><label>Start time<input type="time" required value={editing.time} onChange={e=>setEditing({...editing,time:e.target.value})}/></label><label>Responsible role<input maxLength={80} value={editing.owner} onChange={e=>setEditing({...editing,owner:e.target.value})}/></label></div>{error&&<p role="alert" className="error-box">{error}</p>}<button className="button primary">Save activity</button></form>}</Drawer>
 </section>;
}
