import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const apiRequire=createRequire(join(root,'apps/api/package.json'));
const {default:inject}=await import(pathToFileURL(apiRequire.resolve('light-my-request')).href);

// Synthetic settings only. This process must not load real credentials or call providers.
Object.assign(process.env,{
	SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable-placeholder',
	WEB_ORIGIN:'https://gather.example',GROQ_API_KEY:'',GEMINI_API_KEY:'',GEOAPIFY_API_KEY:'',DIRECTORY_ENABLED:'false',
});
const {default:handler}=await import(pathToFileURL(join(root,'dist/api/apps/api/api/index.js')).href);
const health=await inject(handler,{method:'GET',url:'/health'});
assert.equal(health.statusCode,200);
assert.equal(health.json().status,'ok');
const denied=await inject(handler,{method:'GET',url:'/api/events'});
assert.equal(denied.statusCode,401);
const preflight=await inject(handler,{method:'OPTIONS',url:'/api/events',headers:{origin:process.env.WEB_ORIGIN,'access-control-request-method':'POST'}});
assert.equal(preflight.statusCode,204);
assert.equal(preflight.headers['access-control-allow-origin'],process.env.WEB_ORIGIN);
console.log('Compiled API handler passed: health 200, auth rejection 401, CORS 204. No listening socket, TypeScript runtime flags or live services used.');
