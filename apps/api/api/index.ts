import { buildApp } from '../src/buildApp.ts';
import { configSchema } from '../src/config.ts';
import { createServerlessHandler } from '../src/serverless.ts';

let application:ReturnType<typeof buildApp>|undefined;
export default createServerlessHandler(()=>{
	application??=buildApp(configSchema.parse(process.env));
	return application;
});
