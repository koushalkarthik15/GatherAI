import { configSchema } from './config.ts';
import Fastify from 'fastify';
import { configureApp, serverOptions } from './buildApp.ts';
const parsed=configSchema.safeParse(process.env);
if(!parsed.success){
 console.error('API configuration is missing or invalid. Fill apps/api/.env using .env.example. Values are not logged.');
 process.exit(1);
}
const config=parsed.data;
const app=Fastify(serverOptions());
async function start(){
	try{
		await configureApp(app,config);
		await app.listen({port:config.PORT,host:config.HOST});
		console.log('Gather API listening on port '+config.PORT);
	}catch(error){
		const rawCode=error&&typeof error==='object'&&'code'in error?error.code:'';
		const code=typeof rawCode==='string'&&['EADDRINUSE','EACCES','EADDRNOTAVAIL'].includes(rawCode)?rawCode:'STARTUP_ERROR';
		console.error({event:'api_startup_failed',code,host:config.HOST,port:config.PORT});
		console.error('API could not start. Check the configured host and port.');
		process.exit(1);
	}
}
// Keep module evaluation separate from asynchronous listener startup.
void start();
