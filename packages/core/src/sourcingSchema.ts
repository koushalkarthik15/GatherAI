import { z } from 'zod';
export const resourceKinds=['venue','food','equipment','decorations','permissions','other'] as const;
export function safeWebUrl(value:string):string|null{
 try{
  const url=new URL(value);
  const host=url.hostname.toLowerCase();
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
   !host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||
   host.endsWith('.internal')||/^[\d.]+$/.test(host)||host.includes(':')||url.port)return null;
  return url.href;
 }catch{return null;}
}
export const resourceDetailsSchema=z.object({
 kind:z.enum(resourceKinds).optional(),
 quantity:z.number().int().min(1).max(100000).optional(),
 approach:z.enum(['borrow','donation','rental','vendor','approval','undecided']).optional(),
 enquiry:z.enum(['Not contacted','Contacted','Quote received','Chosen']).optional(),
 contact:z.string().trim().max(200).optional(),
 url:z.string().max(1500).refine(value=>!value||Boolean(safeWebUrl(value)),'Use a public HTTP(S) website without credentials.').optional(),
 notes:z.string().max(2000).optional(),
 quote:z.number().int().min(0).max(1_000_000_000).optional(),
 budgetId:z.string().min(1).max(100).optional(),
 discoveryId:z.string().regex(/^(node|way|relation):[0-9]+$/).optional(),
}).strict();
export const sourcingSettingsSchema=z.object({area:z.string().trim().max(120).optional()}).strict();
export const venueSearchInput=z.object({
 area:z.string().trim().min(2).max(120).refine(value=>![...value].some(character=>character.charCodeAt(0)<32)),
 kind:z.enum(['venue','food','equipment']).optional(),
 radiusKm:z.union([z.literal(5),z.literal(10),z.literal(20)]),
}).strict();
export const venueSchema=z.object({
 id:z.string().regex(/^(node|way|relation):[0-9]+$/),name:z.string().min(1).max(300),
 address:z.string().max(500),distanceKm:z.number().nonnegative().max(25),
 capacity:z.number().int().positive().max(100000).nullable(),
 wheelchair:z.enum(['yes','limited','no','unknown']),
 sourceUrl:z.url().refine(value=>/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/[0-9]+$/.test(value)),
});
export const venueSearchResponse=z.object({
 area:z.string().max(500),radiusKm:z.number(),venues:z.array(venueSchema).max(12),
 attribution:z.literal('© OpenStreetMap contributors — ODbL'),
});
export type Venue=z.infer<typeof venueSchema>;
export type ResourceDetails=z.infer<typeof resourceDetailsSchema>;
