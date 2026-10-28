import { useState } from 'react';
import { formatMoney } from '@gather/core';
import { chooseResource, kindLabels, safeWebUrl } from '@gather/core/sourcing';
import type { Studio } from '../state/useStudio';

type ShortlistKind='venue'|'food'|'equipment';
export function VenueComparison({studio}:{studio:Studio}) {
 const {event,update}=studio;
 const [filter,setFilter]=useState<'all'|ShortlistKind>('all');
 const options=event.resources.filter(item=>{
  const kind=item.details?.kind;
  return (kind==='venue'||kind==='food'||kind==='equipment')&&(filter==='all'||kind===filter);
 });
 return <section className="panel">
  <div className="section-heading"><div><p className="eyebrow">YOUR SHORTLIST</p><h2>Compare saved options</h2></div></div>
  <p className="muted">Compare saved venues, food and equipment options. Confirm services, accessibility, availability and all costs directly.</p>
  <label>Show options<select value={filter} onChange={e=>setFilter(e.target.value as 'all'|ShortlistKind)}><option value="all">All categories</option><option value="venue">Venues</option><option value="food">Food and refreshments</option><option value="equipment">Sound and equipment</option></select></label>
  {!options.length?<p className="empty-state">No saved options in this category. Save a search result or add a venue, food or equipment resource to compare it here.</p>:
   <div className="table-scroll"><table><thead><tr><th>Option / type</th><th>Source</th><th>Arrangement status</th><th>Quote</th><th>Details and gaps</th><th>Choice</th></tr></thead>
    <tbody>{options.map(item=>{
     const details=item.details!,url=details.url?safeWebUrl(details.url):null;
     const kind=details.kind as ShortlistKind;
     const chosen=details.enquiry==='Chosen';
     return <tr key={item.id}>
      <td><strong>{item.name}</strong><span className="table-subtitle">{kindLabels[kind]}</span></td>
      <td>{item.source||'Not recorded'}{url&&<p><a href={url} target="_blank" rel="noopener noreferrer">Open source</a></p>}</td>
      <td>{item.status}<span className="table-subtitle">{details.enquiry??'Not contacted'}</span></td>
      <td>{details.quote===undefined?'Not recorded':formatMoney(details.quote)}</td>
      <td>{details.notes||'Services, availability and other details not recorded.'}</td>
      <td>
       {chosen?<><strong>Chosen</strong><label><span className="sr-only">{item.name} enquiry stage</span><select value="Chosen" onChange={e=>update({...event,resources:event.resources.map(resource=>resource.id===item.id?{...resource,details:{...resource.details,enquiry:e.target.value as 'Not contacted'|'Contacted'|'Quote received'|'Chosen'}}:resource)},'Enquiry stage updated.')}><option>Chosen</option><option>Not contacted</option><option>Contacted</option><option>Quote received</option></select></label></>:
        <button className="button secondary" onClick={()=>update(chooseResource(event,item.id),'Option marked as chosen. Confirm arrangements directly.')}>Finalize choice</button>}
      </td>
     </tr>;
    })}</tbody>
   </table></div>}
  <p className="fine-print">Choosing records your preference; it does not book, confirm availability or change your budget. You can choose multiple options and change a chosen option's enquiry stage.</p>
 </section>;
}