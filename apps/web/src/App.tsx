import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowRight, Check, ChevronDown, CircleHelp, Flower2, LayoutDashboard, ListChecks, LogIn, MapPin, Plus, Printer, RotateCcw, Sparkles, Undo2, Wallet, CalendarDays } from 'lucide-react';
import { formatMoney, totals } from '@gather/core';
import { Drawer } from './components/Dialog';
import { Overview } from './features/Overview';
const EventBriefEditor = lazy(() => import('./features/EventBrief').then(m => ({default:m.EventBriefEditor})));
const EventChangePreview = lazy(() => import('./features/EventChangePreview').then(m => ({default:m.EventChangePreview})));
const PlanningSettings = lazy(() => import('./features/PlanningSettings').then(m => ({default:m.PlanningSettings})));
const Tasks = lazy(() => import('./features/Tasks').then(m => ({default:m.Tasks})));
const Budget = lazy(() => import('./features/Budget').then(m => ({default:m.Budget})));
const Resources = lazy(() => import('./features/Resources').then(m => ({default:m.Resources})));
const Schedule = lazy(() => import('./features/Details').then(m => ({default:m.Schedule})));
const Revision = lazy(() => import('./features/Revision').then(m => ({default:m.Revision})));
import type { Studio } from './state/useStudio';

const navigation = [
 {path:'/',label:'Overview',icon:LayoutDashboard},{path:'/plan',label:'Plan',icon:ListChecks},
 {path:'/budget',label:'Budget',icon:Wallet},{path:'/resources',label:'Resources',icon:MapPin},
 {path:'/schedule',label:'Schedule',icon:CalendarDays},
];
const pageCopy: Record<string,[string,string]> = {
 '/plan':['Make it happen.','A clear next step for every part of your gathering.'],
 '/budget':['Room for the good things.','Your funds, commitments, and flexible choices.'],
 '/resources':['Bring it all together.','The people, places, and pieces behind your event.'],
 '/schedule':['Make every moment count.','A running order with room to breathe.'],
};
type WorkspaceProps = {studio:Studio;mode:'demo'|'saved';userId?:string;email?:string;saveStatus?:string;onSignIn?:()=>void;onSignOut?:()=>void;onCreate?:()=>void;onReload?:()=>void;onPlan?:()=>void;fundingBlocked?:boolean;onFundingRefresh?:()=>Promise<void>};
export function Workspace({studio,mode,userId,email,saveStatus,onSignIn,onSignOut,onCreate,onReload,onPlan,fundingBlocked,onFundingRefresh}:WorkspaceProps) {
 const {event}=studio;
 const location=useLocation();const reduce=useReducedMotion();
 const [revisionOpen,setRevisionOpen]=useState(false);
 const [briefOpen,setBriefOpen]=useState(false);
 const [changeOpen,setChangeOpen]=useState(false);
 const [settingsOpen,setSettingsOpen]=useState(false);
 const [info,setInfo]=useState<'help'|'reset'|null>(null);
 const heading=useRef<HTMLDivElement>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[location.pathname,event.id]);
 const copy=pageCopy[location.pathname];
 const sum=totals(event);
 return <div className="studio-shell">
  <a className="skip-link" href="#main">Skip to workspace</a>
  <aside className="sidebar"><NavLink to="/" className="brand" aria-label="Gather home"><Flower2 size={31} strokeWidth={1.5}/><span>gather<span className="brand-period">.</span></span></NavLink><p className="brand-caption">GOOD THINGS, TOGETHER.</p>
   <div className="workspace-label">YOUR WORKSPACE</div>
   <nav className="primary-nav" aria-label="Workspace">{navigation.map(item=><NavLink key={item.path} to={item.path} end={item.path==='/'}><item.icon size={18}/><span>{item.label}</span>{item.path==='/plan'&&<span className="nav-count">{event.tasks.filter(t=>t.status!=='Done').length}</span>}</NavLink>)}</nav>
   <div className="sidebar-bottom"><div className="sidebar-note"><span aria-hidden="true">?</span><p>A little planning.<br/>A lot of possibility.</p></div><button className="help-button" onClick={()=>setInfo('help')}><CircleHelp size={17}/>A little guidance</button><div className="profile"><span className="avatar">YO</span><div><strong>{mode==='saved'?email:'Your event studio'}</strong><span>{mode==='saved'?'Saved workspace':'Interactive local demo'}</span></div></div></div>
  </aside>
  <div className="workspace"><header className="topbar"><div className="event-switcher"><span className="topbar-caption">YOUR EVENT</span>
   <DropdownMenu.Root><DropdownMenu.Trigger className="event-trigger">{event.name}<ChevronDown size={16}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown" sideOffset={10} align="start"><DropdownMenu.Label className="dropdown-label">SWITCH EVENTS</DropdownMenu.Label>{[...studio.events].sort((a,b)=>Number(Boolean(a.archived))-Number(Boolean(b.archived))).map(e=><DropdownMenu.Item key={e.id} className="dropdown-item" onSelect={()=>{studio.setEventId(e.id);setRevisionOpen(false);}}><span className={'event-dot '+e.color}/><span>{e.name}{e.archived?' (Archived)':''}</span>{e.id===event.id&&<Check size={15}/>}</DropdownMenu.Item>)}<DropdownMenu.Separator className="dropdown-separator"/><DropdownMenu.Item className="dropdown-item" onSelect={()=>{if(mode==='saved')onCreate?.();else onSignIn?.();}}><Plus size={16}/>Create another event{mode==='demo'&&<span className="soon">SIGN IN</span>}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>
   <div className="topbar-actions"><span className="save-indicator"><span className="dot"/>{mode==='saved'?saveStatus:studio.storageError?'Save needs attention':'Saved in this browser'}</span><button className="icon-button print-button" onClick={()=>window.print()} aria-label="Print event plan"><Printer size={18}/></button><button className="button secondary sign-in" onClick={()=>{if(mode==='saved')onSignOut?.();else onSignIn?.();}}><LogIn size={15}/>{mode==='saved'?'Sign out':'Sign in'}</button></div>
  </header>
  <div className="mobile-nav"><nav aria-label="Mobile workspace">{navigation.map(n=><NavLink key={n.path} to={n.path} end={n.path==='/'}><n.icon size={17}/>{n.label}</NavLink>)}</nav></div>
  <main id="main" className="main-content"><div className="workspace-utility" ref={heading} tabIndex={-1}><div className="breadcrumb">Your workspace <span>/</span> {navigation.find(n=>n.path===location.pathname)?.label??'Overview'}<span className="demo-badge">{mode==='demo'?'DEMO':'SAVED'}</span></div><div className="utility-actions"><button className="button secondary" onClick={()=>setSettingsOpen(true)}>Planning rules</button><button className="button secondary" onClick={()=>setChangeOpen(true)}>Preview event changes</button><button className="button secondary" onClick={()=>studio.update({...event,archived:!event.archived},event.archived?'Event restored.':'Event archived. You can restore it from the event switcher.')}>{event.archived?'Restore event':'Archive event'}</button><button className="button secondary" onClick={()=>setBriefOpen(true)}>Event details</button><button className="text-button undo-button" disabled={!studio.canUndo} onClick={studio.undo}><Undo2 size={15}/>Undo</button><button className="button primary" onClick={()=>{if(mode==='saved')onPlan?.();else setRevisionOpen(true);}}><Sparkles size={15}/>{mode==='saved'?'Plan with AI':'Adjust with AI'}{mode==='demo'&&<span className="button-demo">DEMO</span>}</button></div></div>
   {studio.storageError&&<div className="error-box" role="alert">{studio.storageError}<button className="text-button" onClick={studio.retrySave}>Retry saving</button>{mode==='demo'?<button className="text-button" onClick={()=>setInfo('reset')}>Reset demo</button>:<button className="text-button" onClick={onReload}>Reload saved version</button>}</div>}
   {studio.hasRollback&&<div className="rollback-banner"><span>{studio.canRollback?'Your latest demo revision can be rolled back.':'Later edits are protected. Rollback is unavailable after further edits.'}</span><button className="text-button" onClick={studio.rollback} disabled={!studio.canRollback}><RotateCcw size={14}/>Restore previous plan</button></div>}
   <AnimatePresence mode="wait" initial={false}><motion.div key={event.id+location.pathname} initial={{opacity:0,y:reduce?0:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:-5}} transition={{duration:reduce?0:.22}}>
    {copy&&<div className="page-heading"><p className="eyebrow">{event.name}</p><h1>{copy[0]}</h1><p className="muted">{copy[1]}</p></div>}
    <Suspense fallback={<div className="panel" role="status">Opening your workspace...</div>}><Routes><Route path="/" element={<Overview studio={studio} allowRevision={mode==='demo'} onRevision={()=>{if(mode==='demo')setRevisionOpen(true);}}/>}/><Route path="/plan" element={<Tasks studio={studio}/>}/><Route path="/budget" element={<Budget studio={studio} userId={userId} blocked={Boolean(fundingBlocked)} onRefresh={onFundingRefresh}/>}/><Route path="/resources" element={<Resources studio={studio} userId={userId}/>}/><Route path="/schedule" element={<Schedule studio={studio}/>}/><Route path="*" element={<div className="panel"><h1>A little off the path.</h1><NavLink to="/">Return to your overview</NavLink></div>}/></Routes></Suspense>
   </motion.div></AnimatePresence>
   <footer className="workspace-footer"><span>Made for the moments that bring us together.</span><span>Gather Event Studio ? {mode==='demo'?'Local demo':'Saved workspace'}</span></footer>
  </main>
  </div>
  <Suspense fallback={<div role="status" className="toast">Opening panel...</div>}>
  {settingsOpen&&<PlanningSettings key={event.id} studio={studio} onClose={()=>setSettingsOpen(false)}/>}
  {changeOpen&&<EventChangePreview key={event.id} event={event} userId={userId} blocked={Boolean(fundingBlocked)} onRefresh={onFundingRefresh} onClose={()=>setChangeOpen(false)}/>}
  {briefOpen&&<EventBriefEditor key={event.id} studio={studio} onClose={()=>setBriefOpen(false)}/>}
  {revisionOpen&&<Suspense fallback={<div role="status" className="toast">Opening revision preview...</div>}><Revision key={event.id} studio={studio} open onClose={()=>setRevisionOpen(false)}/></Suspense>}
  </Suspense>
  <div className="toast-slot" role="status" aria-live="polite">{studio.message&&<div className="toast"><Check size={16}/><span>{studio.message}</span>{studio.canUndo&&<button onClick={studio.undo}>Undo</button>}<button className="toast-dismiss" onClick={()=>studio.setMessage('')} aria-label="Dismiss notification">x</button></div>}</div>
  <Drawer open={info!==null} onClose={()=>setInfo(null)} title={info==='reset'?'Start with a fresh canvas?':'A little guidance.'} description={info==='reset'?'This removes your local demo edits and restores all sample events.':mode==='demo'?'This is an interactive frontend demo. No model or external service is connected.':'Your edits save to your account. Initial AI generation is available for empty events.'}>
   {info==='reset'?<><p>Your edits in this browser will be replaced. This action cannot be undone.</p><button className="button primary" onClick={()=>{studio.reset();setInfo(null);}}>Reset all sample events</button></>:<div className="info-content"><p>Edit a task by selecting its title. Complete or reopen with its checkbox. Reorder within a group using the drag handle, keyboard drag controls, or arrow buttons. Undo restores the latest manual change.</p>{mode==='demo'?<p>Try a budget change with <strong>Adjust with AI</strong>. The preview is simulated, protects commitments and spending, and applies only after you accept.</p>:<p>Manual changes autosave. If saving fails, keep this tab open and retry. Plan with AI suggests additions for your event. Review the proposal before applying; existing entries stay unchanged.</p>}<button className="button secondary" onClick={()=>setInfo(null)}>Back to the studio<ArrowRight size={16}/></button>{info==='help'&&mode==='demo'&&<button className="text-button reset-link" onClick={()=>setInfo('reset')}>Reset sample data</button>}</div>}
  </Drawer>
  <section className="print-plan"><h1>{event.name}</h1><p>{event.date} ? {event.location} ? {event.guests} guests</p><p>{event.description}</p><h2>Funding & budget</h2><p>Confirmed {formatMoney(event.confirmed)} ? Pending {formatMoney(event.pending)} (excluded) ? Ceiling {formatMoney(sum.ceiling)}</p><table><thead><tr><th>Item</th><th>Estimate</th><th>Actual</th><th>Commitment</th></tr></thead><tbody>{event.budget.map(b=><tr key={b.id}><td>{b.name}</td><td>{formatMoney(b.estimate)}</td><td>{formatMoney(b.actual)}</td><td>{b.committed?'Committed':'Flexible'}</td></tr>)}</tbody></table><h2>Preparation checklist</h2>{event.groups.map(g=><div key={g.id}><h3>{g.name}</h3>{event.tasks.filter(t=>t.groupId===g.id).map(t=><p key={t.id}>[{t.status==='Done'?'x':' '}] {t.title} - {t.owner} ? {t.due} ? {t.status}{t.notes?' / '+t.notes:''}</p>)}</div>)}<h2>Resources</h2>{event.resources.map(r=><p key={r.id}>{r.name} - {r.status} ? {r.source}</p>)}<h2>Running order</h2>{[...event.agenda].sort((a,b)=>a.time.localeCompare(b.time)).map(a=><p key={a.id}>{a.time} - {a.title} ? {a.owner}</p>)}<h2>Assumptions</h2><p>{mode==='demo'?'Sample data. AI previews use simulated proportional arithmetic. ':''}Prices are estimates. Vendor availability is organizer-entered and unverified.</p></section>
 </div>;
}
