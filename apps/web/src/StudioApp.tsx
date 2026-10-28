import { lazy, Suspense, useState } from 'react';
import { useAuth } from './auth/useAuth';
import { Workspace } from './App';
import { useStudio } from './state/useStudio';

const SavedWorkspace = lazy(() => import('./SavedWorkspace').then(m => ({default:m.SavedWorkspace})));
const AuthPanel = lazy(() => import('./auth/AuthPanel').then(m => ({default:m.AuthPanel})));

function DemoWorkspace({onSignIn}:{onSignIn:()=>void}){
 const studio=useStudio();
 return <Workspace studio={studio} mode="demo" onSignIn={onSignIn}/>;
}
export function App(){
 const auth=useAuth();
 const [authOpen,setAuthOpen]=useState(false);
 const [recoveryDismissed,setRecoveryDismissed]=useState(false);
 if(auth.loading)return <main className="account-welcome" role="status"><h1>Opening your studio...</h1></main>;
 return <>
  <Suspense fallback={<main className="account-welcome" role="status">Opening your saved workspace...</main>}>
  {auth.session?<SavedWorkspace key={auth.session.user.id} userId={auth.session.user.id} email={auth.session.user.email??'Your account'} onSignOut={auth.signOut}/>:<DemoWorkspace onSignIn={()=>setAuthOpen(true)}/>}
  </Suspense>
  {auth.error&&<div className="account-error" role="alert">{auth.error}</div>}
  <Suspense fallback={<div className="toast" role="status">Opening sign in...</div>}>
  {(authOpen||(auth.recovery&&!recoveryDismissed))&&<AuthPanel key={auth.recovery?'recovery':'signin'} recovery={auth.recovery} onClose={()=>{setAuthOpen(false);setRecoveryDismissed(true);}} onRecovered={auth.finishRecovery}/>}
  </Suspense>
 </>;
}
