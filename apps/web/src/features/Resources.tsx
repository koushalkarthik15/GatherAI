import { useState } from 'react';
import { Clipboard, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { eventSchema, formatMoney, totals, type EventPlan } from '@gather/core';
import { kindLabels, resourceEnquiry, resourceKinds, safeWebUrl, sourcingGuides, applyResourceQuote } from '@gather/core/sourcing';
import { Drawer } from '../components/Dialog';
import { NumberInput } from '../components/NumberInput';
import { VenueDiscovery } from './VenueDiscovery';
import { VenueComparison } from './VenueComparison';
import type { Studio } from '../state/useStudio';
type Resource=EventPlan['resources'][number];
const approaches={borrow:'Borrow / campus',donation:'Donation',rental:'Rental',vendor:'Buy / supplier',approval:'Approval',undecided:'Not decided'} as const;
export function Resources({studio,userId}:{studio:Studio;userId?:string}){
 const {event,update}=studio;
 const [editing,setEditing]=useState<Resource|null>(null);
 const [fresh,setFresh]=useState(false),[error,setError]=useState('');
 const [quote,setQuote]=useState('');
 const [removing,setRemoving]=useState<Resource|null>(null);
 const [arranging,setArranging]=useState<string|null>(null);
 const resource=event.resources.find(item=>item.id===arranging);
 const linked=event.budget.find(item=>item.id===resource?.details?.budgetId);
 const nextExposure=resource?.details?.quote===undefined?null:totals(event).exposure-
  (linked?Math.max(linked.estimate,linked.actual):0)+Math.max(resource.details.quote,linked?.actual??0);
 function edit(item?:Resource){
  setEditing(item?structuredClone(item):{id:crypto.randomUUID(),name:'',source:'',status:'Needed',details:{kind:'other',approach:'undecided',enquiry:'Not contacted'}});
  setFresh(!item);setError('');setQuote(item?.details?.quote===undefined?'':String(item.details.quote/100));
 }
 async function copyEnquiry(item:Resource){
  try{await navigator.clipboard.writeText(resourceEnquiry(event,item));studio.setMessage('Enquiry copied. Review it before sending; nothing was sent.');}
  catch{setError('Copy is unavailable. Select and copy the enquiry text below.');}
 }
 function adoptQuote(item:Resource){
  try{update(applyResourceQuote(event,item.id,crypto.randomUUID),'Quote used as an estimate. Recorded spending stays unchanged.');}
  catch(error){setError(error instanceof Error?error.message:'Could not use this quote.');}
 }
 return <div className="sourcing-stack">
  <VenueDiscovery key={event.id} studio={studio} userId={userId}/>
  <VenueComparison studio={studio}/>
  <section className="panel"><div className="section-heading"><div><p className="eyebrow">MAKE THE ARRANGEMENTS</p><h2>Find it. Ask. Arrange.</h2><p className="muted">Borrow, request a donation, rent or compare suppliers. Keep your next step here.</p></div><button className="button secondary" disabled={event.resources.length>=100} onClick={()=>edit()}><Plus size={15}/>Add resource</button></div>
   {!event.resources.length&&<p className="empty-state">Save a venue above or add your first resource. You can record campus options and donated items too.</p>}
   <div className="sourcing-resource-list">{event.resources.map(item=>{
    const details=item.details,kind=details?.kind??'other',url=details?.url?safeWebUrl(details.url):null;
    return <article className="sourcing-resource" key={item.id}>
     <div className="sourcing-resource-heading"><div><p className="eyebrow">{kindLabels[kind]}{details?.quantity?' · '+details.quantity+' needed':''}</p><h3>{item.name}</h3><p className="muted">{item.source||'Source to find'} · {approaches[details?.approach??'undecided']}</p></div>
      <div className="sourcing-card-actions"><button className="icon-button" aria-label={'Edit '+item.name} onClick={()=>edit(item)}><Pencil size={16}/></button><button className="icon-button" aria-label={'Remove '+item.name} onClick={()=>setRemoving(item)}><Trash2 size={16}/></button></div>
     </div>
     <div className="sourcing-facts"><span className="pill">{details?.enquiry??'Not contacted'}</span><label><span className="sr-only">{item.name} arrangement status</span><select value={item.status} onChange={e=>update({...event,resources:event.resources.map(r=>r.id===item.id?{...r,status:e.target.value as Resource['status']}:r)},'Arrangement status saved.')}>{['Needed','Requested','Confirmed','Reconfirmation needed'].map(status=><option key={status}>{status}</option>)}</select></label><span>{details?.quote===undefined?'No quote recorded':'Quoted total '+formatMoney(details.quote)}</span></div>
     <div className="sourcing-card-actions"><button className="text-button" onClick={()=>{setArranging(item.id);setError('');}}>How to arrange this</button>{url&&<a href={url} target="_blank" rel="noopener noreferrer">Open source<ExternalLink size={13}/></a>}</div>
     {details?.discoveryId&&<p className="source-credit">Mapped source: <a href={'https://www.openstreetmap.org/'+details.discoveryId.replace(':','/')} target="_blank" rel="noopener noreferrer">OpenStreetMap contributors · ODbL</a>. Details need confirmation.</p>}
    </article>;
   })}</div>
   <p className="fine-print">Enquiry stages and saved quotes are organizer-entered. A saved option is not a booking. Removing a resource keeps its budget item; Undo restores resource details.</p>
  </section>
  <Drawer open={Boolean(editing)} onClose={()=>setEditing(null)} title={fresh?'Something to arrange.':'Keep the details together.'} description="Record your own source, quote and notes. Nothing is contacted or booked automatically.">
   {editing&&<form className="form-stack" onSubmit={e=>{
    e.preventDefault();
    const quoteValue=quote.trim()===''?undefined:Math.round(Number(quote)*100);
    const next={...editing,details:{...editing.details,quote:quoteValue}};
    const parsed=eventSchema.shape.resources.element.safeParse(next);
    if(!parsed.success||!editing.name.trim()){setError(parsed.success?'Add a resource name.':parsed.error.issues[0]?.message??'Check the fields.');return;}
    if(update({...event,resources:fresh?[...event.resources,{...parsed.data,name:editing.name.trim()}]:event.resources.map(item=>item.id===editing.id?{...parsed.data,name:editing.name.trim()}:item)},'Resource details saved.'))setEditing(null);else setError('Could not save this resource. Check the event item limits and other fields.');
   }}>
    <label>Resource or venue name<input required maxLength={160} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
    <div className="field-pair"><label>Type<select value={editing.details?.kind??'other'} onChange={e=>setEditing({...editing,details:{...editing.details,kind:e.target.value as typeof resourceKinds[number]}})}>{resourceKinds.map(kind=><option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label><label>Quantity (optional)<NumberInput min={1} max={100000} step={1} value={editing.details?.quantity??''} onValueChange={value=>setEditing({...editing,details:{...editing.details,quantity:value?Number(value):undefined}})}/></label></div>
    <label>Source or supplier<input maxLength={300} value={editing.source} placeholder="Campus facilities, a local supplier, or still to find" onChange={e=>setEditing({...editing,source:e.target.value})}/></label>
    <div className="field-pair"><label>How to source it<select value={editing.details?.approach??'undecided'} onChange={e=>setEditing({...editing,details:{...editing.details,approach:e.target.value as keyof typeof approaches}})}>{Object.entries(approaches).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Enquiry stage<select value={editing.details?.enquiry??'Not contacted'} onChange={e=>setEditing({...editing,details:{...editing.details,enquiry:e.target.value as NonNullable<Resource['details']>['enquiry']}})}>{['Not contacted','Contacted','Quote received','Chosen'].map(stage=><option key={stage}>{stage}</option>)}</select></label></div>
    <label>Contact details (optional)<input maxLength={200} value={editing.details?.contact??''} onChange={e=>setEditing({...editing,details:{...editing.details,contact:e.target.value}})}/></label>
    <label>Source website (optional)<input type="url" maxLength={1500} placeholder="https://..." value={editing.details?.url??''} onChange={e=>setEditing({...editing,details:{...editing.details,url:e.target.value}})}/></label>
    <label>Total quoted amount — INR (optional)<NumberInput min={0} max={10000000} step=".01" value={quote} onValueChange={setQuote}/></label>
    <p className="fine-print">Enter the total including fees/taxes. Saving a quote does not update spending or the budget; review that separately.</p>
    <label>Notes<textarea rows={4} maxLength={2000} value={editing.details?.notes??''} onChange={e=>setEditing({...editing,details:{...editing.details,notes:e.target.value}})}/></label>
    {error&&<p role="alert" className="error-box">{error}</p>}<button className="button primary">Save resource</button>
   </form>}
  </Drawer>
  <Drawer open={Boolean(resource)} onClose={()=>setArranging(null)} title={resource?.name??'Arrange a resource'} description="A practical starting point. Confirm the requirements and a written quote directly with the responsible person.">
   {resource&&<div className="arrange-guide"><h3>Start here</h3><ol>{sourcingGuides[resource.details?.kind??'other'].start.map(step=><li key={step}>{step}</li>)}</ol>
    <h3>Ask before you confirm</h3><ul>{sourcingGuides[resource.details?.kind??'other'].questions.map(question=><li key={question}>{question}</li>)}</ul>
    <h3>Your enquiry draft</h3><textarea className="enquiry-draft" rows={10} readOnly value={resourceEnquiry(event,resource)} aria-label="Enquiry draft to review and copy"/><button className="button secondary" onClick={()=>void copyEnquiry(resource)}><Clipboard size={15}/>Copy enquiry</button>
    {resource.details?.contact&&<p className="fine-print">Your contact: {resource.details.contact}</p>}
    {resource.details?.notes&&<p className="sourcing-notes">{resource.details.notes}</p>}
    {resource.details?.quote!==undefined&&<section className="quote-review"><h3>Review quote for your budget</h3><p>Quoted total: <strong>{formatMoney(resource.details.quote)}</strong>. This is an estimate update, not recorded spending.</p>
     {resource.details.budgetId&&event.budget.find(item=>item.id===resource.details?.budgetId)&&<p>Current linked estimate: {formatMoney(event.budget.find(item=>item.id===resource.details?.budgetId)!.estimate)}.</p>}
     {event.budget.find(item=>item.id===resource.details?.budgetId)?.committed?<p className="error-box">This budget item is committed. Review and edit it directly in Budget.</p>:<>
      {resource.details.quote<(event.budget.find(item=>item.id===resource.details?.budgetId)?.actual??0)&&<p className="fine-print">The estimate will stay at least as high as the recorded actual spending.</p>}
      <p className="fine-print">Current confirmed ceiling: {formatMoney(totals(event).ceiling)}. Existing actual spending and funding are preserved.</p>
      {nextExposure!==null&&nextExposure>totals(event).ceiling&&<p role="status" className="error-box">This quote would put planned exposure {formatMoney(nextExposure-totals(event).ceiling)} above the confirmed ceiling. Revisit other costs or funding before committing.</p>}
      <button className="button primary" disabled={!resource.details.budgetId&&event.budget.length>=100} onClick={()=>adoptQuote(resource)}>{resource.details.budgetId?'Update linked estimate':'Add quote to budget'}</button>
     </>}
    </section>}
    {error&&<p role="alert" className="error-box">{error}</p>}
   </div>}
  </Drawer>
  <Drawer open={Boolean(removing)} onClose={()=>setRemoving(null)} title="Remove this resource?" description="The budget item and recorded spending stay unchanged. You can undo removal in this session.">
   <p>{removing?.name}</p><div className="drawer-actions"><button className="button secondary" onClick={()=>setRemoving(null)}>Keep resource</button><button className="button primary" onClick={()=>{if(removing)update({...event,resources:event.resources.filter(item=>item.id!==removing.id)},'Resource removed. Undo restores its details.');setRemoving(null);}}>Remove resource</button></div>
  </Drawer>
 </div>;
}
