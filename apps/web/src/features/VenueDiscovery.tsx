import { useState } from 'react';
import { MapPin, ExternalLink, Plus } from 'lucide-react';
import { venueSearchResponse, type Venue } from '@gather/core/sourcing';
import type { z } from 'zod';
import { cloudApi } from '../cloud/api';
import type { Studio } from '../state/useStudio';
export function VenueDiscovery({studio,userId}:{studio:Studio;userId?:string}){
 const {event,update}=studio;
 const [api]=useState(()=>userId?cloudApi(userId):null);
 const [area,setArea]=useState(event.sourcing?.area??'');
 const [radius,setRadius]=useState<5|10|20>(10);
 const [kind,setKind]=useState<'venue'|'food'|'equipment'>('venue');
 const [result,setResult]=useState<z.infer<typeof venueSearchResponse>|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function search(){
  if(!api||busy)return;
  setBusy(true);setError('');setResult(null);
  if(event.sourcing?.area!==area.trim())update({...event,sourcing:{...event.sourcing,area:area.trim()}},'Search area saved.');
  try{setResult(await api.venues(event.id,{area:area.trim(),radiusKm:radius,kind}));}
  catch(error){setError(error instanceof Error?error.message:'Could not search venues.');}
  finally{setBusy(false);}
 }
 function save(venue:Venue){
  if(event.resources.some(resource=>resource.details?.discoveryId===venue.id))return;
  if(event.resources.length>=100){setError('This event has reached its 100-resource limit.');return;}
  const notes=[kind==='venue'?'Mapped venue option; date availability and price need confirmation.':'Mapped business lead; event services, availability and price need confirmation.',
   venue.capacity?'Mapped capacity: '+venue.capacity+' (confirm with venue).':'Capacity not mapped.',
   'Mapped wheelchair access: '+venue.wheelchair+'.',venue.address].filter(Boolean).join('\n');
  update({...event,resources:[...event.resources,{
   id:crypto.randomUUID(),name:venue.name,source:result?.area??area,status:'Needed',
   details:{kind,approach:'undecided',enquiry:'Not contacted',url:venue.sourceUrl,discoveryId:venue.id,notes},
  }]},'Option saved. Ask about event services, availability and a written quote.');
 }
 return <section className="panel sourcing-discovery">
  <div className="section-heading"><div><p className="eyebrow">FROM PLAN TO PLACE</p><h2>Find nearby options.</h2><p className="muted">Explore mapped venues near a public city or area, then confirm the details yourself.</p></div><MapPin size={25}/></div>
  <form className="sourcing-search" onSubmit={e=>{e.preventDefault();void search();}}>
   <label>What to find<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as 'venue'|'food'|'equipment');setResult(null);}}><option value="venue">Venues</option><option value="food">Restaurants and cafes</option><option value="equipment">Rental and electronics businesses</option></select></label>
   <label>City or public area<input required minLength={2} maxLength={120} placeholder="e.g. Gachibowli, Hyderabad, India" value={area} disabled={busy} onChange={e=>setArea(e.target.value)}/></label>
   <label>Around area centre<select value={radius} disabled={busy} onChange={e=>setRadius(Number(e.target.value) as 5|10|20)}>{[5,10,20].map(value=><option key={value} value={value}>{value} km</option>)}</select></label>
   <button className="button primary" disabled={busy||!api}>{busy?'Searching mapped places...':'Find options'}</button>
  </form>
  <p className="fine-print">Search sends the public area to Geoapify when you submit. If Geoapify is not configured, OpenStreetMap services are used. No device location or event brief is shared. Food results are restaurants and cafes; equipment results include general rental and electronics businesses. Event services, rental equipment, capacity, access, prices and availability need direct confirmation.</p>
  {!api&&<p className="fine-print">Sign in to search live venues. External map search and manual sourcing remain available.</p>}
  {area.trim().length>=2&&<a className="text-button sourcing-external" href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent((kind==='venue'?'event venues in ':kind==='food'?'event caterers in ':'event equipment rental in ')+area.trim())} target="_blank" rel="noopener noreferrer">Search relevant businesses on Google Maps externally<ExternalLink size={14}/></a>}
  {busy&&<p role="status" className="empty-state">Looking up the area and its mapped venue options...</p>}
  {error&&<p role="alert" className="error-box">{error}</p>}
  {result&&<><p className="fine-print">Results near {result.area}. Distances are approximate straight-line distances from the area centre, not travel distances.</p>
   {!result.venues.length&&<p role="status" className="empty-state">No matching places are mapped in this radius. Try another public area or radius, use external map search, or add an option manually.</p>}
   <div className="venue-grid">{result.venues.map(venue=>{
    const saved=event.resources.some(resource=>resource.details?.discoveryId===venue.id);
    return <article className="venue-card" key={venue.id}><div className="eyebrow">{venue.distanceKm} KM FROM AREA CENTRE</div><h3>{venue.name}</h3><p>{venue.address||'Address not mapped; inspect the source.'}</p>
     <p>{venue.capacity?'Mapped capacity: '+venue.capacity:'Capacity unknown'}{venue.capacity&&venue.capacity<event.guests?' — below your expected attendance':''}</p>
     <p>Mapped wheelchair access: {venue.wheelchair==='unknown'?'unknown':venue.wheelchair}. Confirm before choosing.</p>
     <div className="sourcing-card-actions"><a href={venue.sourceUrl} target="_blank" rel="noopener noreferrer">View map source<ExternalLink size={13}/></a><button className="button secondary" disabled={saved||event.resources.length>=100} onClick={()=>save(venue)}><Plus size={14}/>{saved?'Saved option':'Save option'}</button></div>
    </article>;
   })}</div></>}
  <p className="source-credit">Venue data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, available under <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL</a>. Coverage may be incomplete; public directory services may be unavailable.</p>
 </section>;
}
