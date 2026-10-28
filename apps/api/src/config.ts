import { z } from 'zod';
export const configSchema=z.object({
 SUPABASE_URL:z.url().refine(value=>value.startsWith('https://')||value.startsWith('http://127.0.0.1:')||value.startsWith('http://localhost:'),'Use HTTPS for hosted Supabase.'),
 SUPABASE_PUBLISHABLE_KEY:z.string().min(20),
 WEB_ORIGIN:z.url(),
 PORT:z.coerce.number().int().min(1).max(65535).default(3001),
 HOST:z.string().default('127.0.0.1'),
 GROQ_API_KEY:z.string().optional(),
 GEMINI_API_KEY:z.string().optional(),
 GROQ_MODEL:z.string().regex(/^[a-zA-Z0-9_./-]{1,100}$/).optional(),
 GEMINI_MODEL:z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/).optional(),
 AI_PRIMARY_PROVIDER:z.enum(['groq','gemini']).optional(),
 GEOAPIFY_API_KEY:z.string().optional(),
 DIRECTORY_ENABLED:z.enum(['true','false']).optional(),
 NOMINATIM_URL:z.url().refine(value=>value.startsWith('https://')).optional(),
 OVERPASS_URL:z.url().refine(value=>value.startsWith('https://')).optional(),
});
export type Config=z.infer<typeof configSchema>;
