import { configSchema } from './config.ts';
import { buildApp } from './buildApp.ts';
const parsed=configSchema.safeParse(process.env);
if(!parsed.success){
 console.error('API configuration is missing or invalid. Fill apps/api/.env using .env.example. Values are not logged.');
 process.exit(1);
}
const app=await buildApp(parsed.data);
try{
 await app.listen({port:parsed.data.PORT,host:parsed.data.HOST});
 console.log('Gather API listening on port '+parsed.data.PORT);
}catch(error){
 const rawCode=error&&typeof error==='object'&&'code'in error?error.code:'';
 const code=typeof rawCode==='string'&&['EADDRINUSE','EACCES','EADDRNOTAVAIL'].includes(rawCode)?rawCode:'STARTUP_ERROR';
 console.error({event:'api_startup_failed',code,host:parsed.data.HOST,port:parsed.data.PORT});
 console.error('API could not start. Check the configured host and port.');
 process.exit(1);
}
