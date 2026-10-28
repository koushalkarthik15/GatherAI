import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL?.trim();
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
function configuredClient():SupabaseClient|null{
 if(!url||!key||key.startsWith('sb_secret_'))return null;
 try{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'&&parsed.hostname!=='localhost'&&parsed.hostname!=='127.0.0.1')return null;
  return createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 }catch{return null;}
}
export const supabase=configuredClient();
