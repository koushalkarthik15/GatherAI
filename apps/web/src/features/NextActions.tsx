import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { EventPlan } from '@gather/core';

export function NextActions({event}:{event:EventPlan}) {
 const navigate=useNavigate();
 const tasks=event.tasks.filter(task=>task.status!=='Done').slice().sort((a,b)=>{
  if(a.status==='Blocked'&&b.status!=='Blocked')return -1;
  if(b.status==='Blocked'&&a.status!=='Blocked')return 1;
  return (a.due||'9999-12-31').localeCompare(b.due||'9999-12-31')||a.title.localeCompare(b.title);
 }).slice(0,3);
 const resources=event.resources.filter(item=>item.status!=='Confirmed').length;
 return <section className="panel" aria-labelledby="next-actions-title">
  <div className="section-heading"><div><p className="eyebrow">KEEP THINGS MOVING</p><h2 id="next-actions-title">Your next actions</h2></div></div>
  <p className="muted">Blocked tasks come first, followed by recorded deadlines. Confirm priorities with your team.</p>
  {tasks.length?<ul>{tasks.map(task=><li key={task.id}><strong>{task.title}</strong> - {task.status}{task.due?' - due '+task.due:' - no deadline'}{task.owner?' - '+task.owner:' - no owner'}{task.dependsOn&&event.tasks.find(item=>item.id===task.dependsOn)?.status!=='Done'?' - prerequisite incomplete':''}</li>)}</ul>:<p className="empty-state">{event.tasks.length?'No open tasks recorded.':'No tasks recorded yet.'}</p>}
  <button className="text-button" onClick={()=>navigate('/plan')}>Open checklist <ArrowRight size={14}/></button>
  {resources>0&&<p className="fine-print">{resources} resource{resources===1?'':'s'} still need attention. <button className="text-button" onClick={()=>navigate('/resources')}>Open resources <ArrowRight size={14}/></button></p>}
 </section>;
}