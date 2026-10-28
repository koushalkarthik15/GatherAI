import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './client';
export function useAuth(){
 const [session,setSession]=useState<Session|null>(null);
 const [loading,setLoading]=useState(Boolean(supabase));
 const [error,setError]=useState('');
 const [recovery,setRecovery]=useState(false);
 useEffect(()=>{
  if(!supabase)return;
  let active=true,observed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{
   observed=true;
   if(active){setSession(next);setLoading(false);if(event==='PASSWORD_RECOVERY')setRecovery(true);}
  });
  supabase.auth.getSession().then(({data,error})=>{
   if(!active||observed)return;
   if(error)setError('Could not restore your session. Sign in again.');
   else setSession(data.session);
   setLoading(false);
  }).catch(()=>{if(active){setError('Could not restore your session.');setLoading(false);}});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 async function signOut(){
  if(!supabase)return;
  const {error}=await supabase.auth.signOut({scope:'local'});
  if(error)throw new Error('Sign-out failed. Retry when connected.');
 }
 return {session,loading,error,signOut,recovery,finishRecovery:()=>setRecovery(false)};
}
