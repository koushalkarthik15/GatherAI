import { useState } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { Drawer } from '../components/Dialog';
import { supabase } from './client';
export function AuthPanel({onClose,recovery=false,onRecovered}:{
 onClose:()=>void;recovery?:boolean;onRecovered?:()=>void;
}){
 const [mode,setMode]=useState<'signin'|'signup'|'reset'|'recovery'>(recovery?'recovery':'signin');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 async function submit(){
  if(!supabase||busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   if(mode==='signin'){
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error)throw new Error('Sign-in failed. Check your email/password and email confirmation, then try again.');
    setPassword('');onClose();
   }else if(mode==='signup'){
    const {data,error}=await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:window.location.origin}});
    if(error)throw new Error('Account creation failed. Check your details or try again later.');
    setPassword('');
    if(data.session)onClose();else setMessage('Check your email for a confirmation link, then return here to sign in. Delivery may take a moment.');
   }else if(mode==='reset'){
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin});
    if(error)throw new Error('The reset request could not be sent. Try again later.');
    setMessage('If an account can receive a reset email, a link will be sent. Check your inbox.');
   }else{
    const {error}=await supabase.auth.updateUser({password});
    if(error)throw new Error('Password update failed. Open a fresh reset link and retry.');
    setPassword('');onRecovered?.();onClose();
   }
  }catch(error){setError(error instanceof Error?error.message:'Authentication failed.');}
  finally{setBusy(false);}
 }
 const title=mode==='signup'?'A home for your gatherings.':mode==='reset'?'Find your way back.':mode==='recovery'?'Choose a new password.':'Your studio, everywhere.';
 return <Drawer title={title} description="Sign in to save your own events. The sample demo stays separate." open onClose={()=>{if(!busy)onClose();}}>
  {!supabase?<div className="info-content"><p>Sign-in is not configured yet. You can continue exploring the local demo.</p><button className="button secondary" onClick={onClose}>Explore demo</button></div>:
  <form className="form-stack" onSubmit={event=>{event.preventDefault();void submit();}}>
   {mode!=='recovery'&&<label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>}
   {mode!=='reset'&&<label>Password<input type="password" autoComplete={mode==='signin'?'current-password':'new-password'} required minLength={mode==='signin'?1:8} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/>{mode!=='signin'&&<span className="fine-print">Use at least 8 characters.</span>}</label>}
   {error&&<p role="alert" className="error-box">{error}</p>}
   {message&&<p role="status" className="demo-notice"><Mail size={18}/>{message}</p>}
   <button className="button primary" disabled={busy}>{busy?'Please wait...':mode==='signup'?'Create account':mode==='reset'?'Send reset link':mode==='recovery'?'Update password':'Sign in'}<ArrowRight size={16}/></button>
   {!recovery&&<div className="auth-links"><button className="text-button" type="button" disabled={busy} onClick={()=>{setMode(mode==='signin'?'signup':'signin');setMessage('');setError('');}}>{mode==='signin'?'New here? Create an account':'Already have an account? Sign in'}</button>{mode==='signin'&&<button className="text-button" type="button" disabled={busy} onClick={()=>{setMode('reset');setMessage('');setError('');}}>Forgot password?</button>}</div>}
  </form>}
 </Drawer>;
}
