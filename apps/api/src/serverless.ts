import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Handle each platform request directly instead of opening a listening socket.
export function createServerlessHandler(loadApp:()=>Promise<FastifyInstance>){
	return async(request:IncomingMessage,response:ServerResponse)=>{
		try{
			const app=await loadApp();
			await app.ready();
			await new Promise<void>((resolve,reject)=>{
				const cleanup=()=>{
					response.off('finish',complete);
					response.off('close',complete);
					response.off('error',failed);
				};
				const complete=()=>{cleanup();resolve();};
				const failed=(error:Error)=>{cleanup();reject(error);};
				response.once('finish',complete);
				response.once('close',complete);
				response.once('error',failed);
				try{app.server.emit('request',request,response);}catch(error){cleanup();reject(error);}
			});
		}catch{
			const requestId=randomUUID();
			console.error({event:'api_handler_failed',code:'API_NOT_READY',requestId});
			if(response.headersSent){response.destroy();return;}
			response.statusCode=500;
			response.setHeader('Content-Type','application/json');
			response.setHeader('Cache-Control','no-store');
			response.setHeader('X-Content-Type-Options','nosniff');
			response.setHeader('Referrer-Policy','no-referrer');
			response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
			response.setHeader('X-Request-Id',requestId);
			response.end(JSON.stringify({code:'API_NOT_READY',message:'The workspace API could not start. Please try again.',requestId}));
		}
	};
}
