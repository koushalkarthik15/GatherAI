import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { feasibilitySummary, formatMoney, type EventPlan } from '@gather/core';

export function Feasibility({event}:{event:EventPlan}) {
 const navigate=useNavigate();
 const facts=feasibilitySummary(event);
 const approvals=event.resources.filter(item=>item.details?.kind==='permissions');
 return <section className="panel feasibility-panel" aria-labelledby="feasibility-title">
  <div className="section-heading"><div><p className="eyebrow">FEASIBILITY OVERVIEW</p><h2 id="feasibility-title">What needs attention</h2></div></div>
  <p className="muted">Based on what you have recorded. Missing details are still unknown; this is not a guarantee your event is ready.</p>
  <div className="feasibility-grid">
   <div className="attention-item">
    <strong>Funding and costs</strong>
    <p>Confirmed funds: {formatMoney(facts.confirmed)}. Spending ceiling: {formatMoney(facts.ceiling)}.</p>
    <p>{facts.pending>0?<>Pending funds: {formatMoney(facts.pending)} (not included in the ceiling).</>:'No pending funds recorded.'}</p>
    {facts.budgetItems===0?<p>No budget items recorded; total costs are unknown.</p>:<>
     <p>Estimates: {formatMoney(facts.estimate)}. Actual spending: {formatMoney(facts.actual)}.</p>
     <p>Cost exposure: {formatMoney(facts.exposure)} (the higher of estimate or actual for each item).</p>
     <p>{facts.remaining<0?<>Recorded exposure exceeds the ceiling by <strong>{formatMoney(-facts.remaining)}</strong>.</>:<>Remaining against recorded exposure: {formatMoney(facts.remaining)}. Other costs may still be missing.</>}</p>
    </>}
    <button className="text-button" onClick={()=>navigate('/budget')}>Review budget <ArrowRight size={14}/></button>
   </div>
   <div className="attention-item">
    <strong>Resources</strong>
    {facts.resourcesRecorded===0?<p>No resources recorded; requirements and availability are unknown.</p>:<p>{facts.resourcesConfirmed} marked confirmed and {facts.resourcesOutstanding} still need attention. Statuses are organizer-entered; availability should be checked directly.</p>}
    <button className="text-button" onClick={()=>navigate('/resources')}>Review resources <ArrowRight size={14}/></button>
   </div>
   <div className="attention-item">
    <strong>Tasks</strong>
    {facts.tasksRecorded===0?<p>No tasks recorded; the work required is unknown.</p>:<p>{facts.tasksBlocked} blocked out of {facts.tasksRecorded} recorded tasks.</p>}
    <button className="text-button" onClick={()=>navigate('/plan')}>Review tasks <ArrowRight size={14}/></button>
   </div>
   <div className="attention-item">
    <strong>Approvals and venue</strong>
    {approvals.length?<p>{approvals.filter(item=>item.status==='Confirmed').length} approval resources marked confirmed; {approvals.filter(item=>item.status!=='Confirmed').length} need attention. Statuses are organizer-entered; verify required approvals directly.</p>:<p>No approval resources recorded; required approvals and their status are unknown.</p>}<p>Venue availability is not verified by this overview.</p><button className="text-button" onClick={()=>navigate('/resources')}>Review approvals <ArrowRight size={14}/></button>
   </div>
  </div>
 </section>;
}