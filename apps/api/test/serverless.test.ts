import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import inject from 'light-my-request';
import { buildApp } from '../src/buildApp.ts';
import { createServerlessHandler } from '../src/serverless.ts';
import type { Repository } from '../src/repository.ts';
import type { Config } from '../src/config.ts';

const config:Config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable-placeholder',WEB_ORIGIN:'https://gather.example',PORT:3001,HOST:'127.0.0.1'};

test('serverless transport preserves routing, auth, JSON bodies and CORS without listen()',async()=>{
	let writes=0;
	const repo:Repository={
		async user(token){assert.equal(token,'test-user');return token;},
		async list(){return [];},
		async get(){return null;},
		async write(_token,plan){writes++;return plan;},
	};
	const app=await buildApp(config,repo,false);
	const handler=createServerlessHandler(async()=>app);
	try{
		const health=await inject(handler,{method:'GET',url:'/health'});
		assert.equal(health.statusCode,200);
		assert.equal(health.json().status,'ok');
		assert.equal(health.headers['cache-control'],'no-store');
		const denied=await inject(handler,{method:'GET',url:'/api/events'});
		assert.equal(denied.statusCode,401);
		assert.equal(writes,0);
		const operation=randomUUID();
		const created=await inject(handler,{
			method:'POST',url:'/api/events',
			headers:{authorization:'Bearer test-user','idempotency-key':operation,'content-type':'application/json'},
			payload:JSON.stringify({name:'Handler test',description:'Synthetic fixture',kind:'Community gathering',date:'2026-12-01',location:'Test hall',guests:10,confirmed:10000,limit:10000}),
		});
		assert.equal(created.statusCode,201);
		assert.equal(created.json().event.name,'Handler test');
		assert.equal(created.json().event.id,operation);
		assert.equal(writes,1);
		const cors=await inject(handler,{method:'OPTIONS',url:'/api/events',headers:{origin:config.WEB_ORIGIN,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}});
		assert.equal(cors.statusCode,204);
		assert.equal(cors.headers['access-control-allow-origin'],config.WEB_ORIGIN);
		assert.equal(app.server.listening,false);
	}finally{await app.close();}
});

test('serverless initialization failures return a safe error without exception details',async t=>{
	const messages:unknown[][]=[];
	t.mock.method(console,'error',(...args:unknown[])=>{messages.push(args);});
	const handler=createServerlessHandler(async()=>{throw new Error('private-provider-value');});
	const response=await inject(handler,{method:'GET',url:'/health'});
	assert.equal(response.statusCode,500);
	assert.equal(response.json().code,'API_NOT_READY');
	assert.equal(response.headers['cache-control'],'no-store');
	assert.equal(response.headers['x-content-type-options'],'nosniff');
	assert.equal(response.headers['referrer-policy'],'no-referrer');
	assert.equal(response.headers['content-security-policy'],"default-src 'none'; frame-ancestors 'none'");
	assert.ok(response.json().requestId);
	assert.ok(!JSON.stringify([response.payload,messages]).includes('private-provider-value'));
});
