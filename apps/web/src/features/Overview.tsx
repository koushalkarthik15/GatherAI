import { ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Poster } from '../components/Poster';
import { Funding } from '../components/Funding';
import { Feasibility } from './Feasibility';
import { NextActions } from './NextActions';
import { lazy, Suspense } from 'react';
const Tasks = lazy(() => import('./Tasks').then(m => ({default:m.Tasks})));
import type { Studio } from '../state/useStudio';
export function Overview({studio,onRevision,allowRevision=true}:{studio:Studio;onRevision:()=>void;allowRevision?:boolean}) {
 const {event}=studio;const navigate=useNavigate();


 return <><Poster event={event}/><div className="welcome-heading"><div><p className="eyebrow">THE BIG PICTURE</p><h2>A great gathering starts here.</h2><p className="muted">A little structure. More space for the moments that matter.</p></div><span className="handwritten" aria-hidden="true">make room for good things ?</span></div>
  <div className="overview-grid"><div className="main-stack"><Feasibility event={event}/><NextActions event={event}/><Funding event={event} onBudget={()=>navigate('/budget')}/><Suspense fallback={<section className="panel" role="status">Opening your checklist...</section>}><Tasks studio={studio} compact/></Suspense></div><aside className="context-stack" aria-label="Event highlights">
   <section className="panel agenda-preview"><div className="section-heading"><h2>On the day</h2><button className="icon-button" onClick={()=>navigate('/schedule')} aria-label="Open schedule"><ArrowUpRight size={18}/></button></div>{[...event.agenda].sort((a,b)=>a.time.localeCompare(b.time)).slice(0,4).map(a=><div className="agenda-mini" key={a.id}><time>{a.time}</time><p>{a.title}</p></div>)}</section>
   <section className="change-card"><Sparkles size={23}/><h2>What if plans change?</h2><p>Make a little less go a little further. Preview an adjustment before committing.</p><button className="text-button" disabled={!allowRevision} onClick={onRevision}>{allowRevision?'Explore a change':'AI planning coming next'}<ArrowRight size={15}/></button><span className="demo-caption">{allowRevision?'SIMULATED AI PREVIEW':'NEXT MILESTONE'}</span></section>
  </aside></div></>;
}

