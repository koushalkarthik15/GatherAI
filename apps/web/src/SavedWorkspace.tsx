import { lazy, Suspense, useState } from 'react';
import { Flower2, Plus } from 'lucide-react';
import { Workspace } from './App';
import { useCloudStudio } from './cloud/useCloudStudio';
import { Drawer } from './components/Dialog';
const AiPlanning = lazy(() => import('./features/AiPlanning').then(m => ({default:m.AiPlanning})));
const CreateEvent = lazy(() => import('./features/CreateEvent').then(m => ({default:m.CreateEvent})));

export function SavedWorkspace({userId,email,onSignOut}:{
 userId:string;email:string;onSignOut:()=>Promise<void>;
}){
 const cloud=useCloudStudio(userId);
 const [creating,setCreating]=useState(false);
 const [planning,setPlanning]=useState(false);
 const [accountError,setAccountError]=useState('');
 const [confirm,setConfirm]=useState<'reload'|'signout'|null>(null);
 async function signOut(){
  try{await onSignOut();}catch(error){setAccountError(error instanceof Error?error.message:'Could not sign out.');}
 }
 function reload(){if(cloud.pending)setConfirm('reload');else void cloud.reload();}
 const create=creating?<CreateEvent onClose={()=>setCreating(false)} onCreate={cloud.create}/>:null;
 return <>
  {accountError&&<div className="account-error" role="alert">{accountError}</div>}
  {cloud.studio&&!cloud.loading?<Workspace studio={cloud.studio} mode="saved" userId={userId} email={email} saveStatus={cloud.status} onSignOut={()=>{if(cloud.pending)setConfirm('signout');else void signOut();}} onCreate={()=>setCreating(true)} onReload={reload} onPlan={()=>setPlanning(true)} fundingBlocked={cloud.pending||Boolean(cloud.error)} onFundingRefresh={async()=>{const id=cloud.studio?.event.id;if(id)await cloud.refreshEvent(id);}}/>:
   <main className="account-welcome"><div className="brand"><Flower2 size={32}/><span>gather.</span></div><p className="eyebrow">YOUR SAVED EVENT STUDIO</p><h1>{cloud.loading?'Opening your studio...':cloud.error?'Your studio needs a moment.':'Good things start here.'}</h1><p>{cloud.loading?'Fetching your own saved events.':cloud.error||'Create your first event. Your sample demo remains separate.'}</p>
    {cloud.error&&<button className="button secondary" onClick={reload}>Retry loading</button>}
    {!cloud.loading&&!cloud.error&&<button className="button primary" onClick={()=>setCreating(true)}><Plus size={16}/>Create an event</button>}
    <button className="text-button" onClick={()=>void signOut()}>Sign out</button>
   </main>}
  <Suspense fallback={<div className="toast" role="status">Opening panel...</div>}>
  {create}
  {planning&&cloud.studio&&<AiPlanning key={cloud.studio.event.id} userId={userId} studio={cloud.studio} blocked={cloud.pending||Boolean(cloud.error)} onClose={()=>setPlanning(false)} onApplied={async()=>{const id=cloud.studio?.event.id;if(id)await cloud.refreshEvent(id);}}/>}
  </Suspense>
  <Drawer title="Keep your unsaved changes?" description="Some changes have not reached your saved workspace." open={confirm!==null} onClose={()=>setConfirm(null)}><p className="muted">Keep this tab open and retry saving to preserve them. Continuing will discard the unsaved edits in this tab.</p><div className="drawer-actions"><button className="button secondary" onClick={()=>setConfirm(null)}>Keep editing</button><button className="button primary" onClick={()=>{const action=confirm;setConfirm(null);if(action==='reload')void cloud.reload();else void signOut();}}>{confirm==='reload'?'Discard edits and reload':'Discard edits and sign out'}</button></div></Drawer>
 </>;
}
