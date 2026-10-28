import { z } from 'zod';
import { venueSearchInput, venueSearchResponse, type Venue } from '@gather/core/sourcing';
export class DirectoryError extends Error{
 code:string; transient:boolean;
 constructor(code:string,transient=false){super(code);this.code=code;this.transient=transient;}
}
type Diagnostic={event:'directory_request';stage:'geocode'|'venues';code:string;durationMs:number;status?:number};
export type DirectorySettings={geocoderUrl:string;overpassUrl:string;enabled:boolean;geoapifyKey?:string};
export const defaultDirectorySettings:DirectorySettings={
 geocoderUrl:'https://nominatim.openstreetmap.org/search',
 overpassUrl:'https://overpass-api.de/api/interpreter',enabled:true,
};
const point=z.object({lat:z.coerce.number().min(-90).max(90),lon:z.coerce.number().min(-180).max(180),display_name:z.string().min(1).max(500)});
const element=z.object({
 type:z.enum(['node','way','relation']),id:z.number().int().positive(),
 lat:z.number().optional(),lon:z.number().optional(),
 center:z.object({lat:z.number(),lon:z.number()}).optional(),
 tags:z.record(z.string(),z.string()),
});
export interface DirectoryGate { reserve():Promise<string>; release(lease:string):Promise<void> }
export type Directory=ReturnType<typeof createDirectory>;
export function createDirectory(settings:DirectorySettings=defaultDirectorySettings,fetcher:typeof fetch=fetch,now:()=>number=Date.now){
 const centers=new Map<string,{expires:number;point:z.infer<typeof point>}>();
 const results=new Map<string,{expires:number;result:z.infer<typeof venueSearchResponse>}>();
 let busy=false,nextSearch=0,day='',daily=0;
 function prune<T>(map:Map<string,T>,maximum:number){while(map.size>maximum){const first=map.keys().next().value;if(first===undefined)break;map.delete(first);}}
 async function request(url:string,stage:Diagnostic['stage'],report:(value:Diagnostic)=>void,body?:string):Promise<unknown>{
  const start=now();let response:Response;
  try{
   response=await fetcher(url,{method:body?'POST':'GET',
    headers:{'User-Agent':'GatherEventStudio/0.1 (explicit low-volume venue discovery)','Accept':'application/json',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
    body,signal:AbortSignal.timeout(stage==='geocode'?8000:12000),redirect:'error'});
  }catch{report({event:'directory_request',stage,code:'NETWORK_OR_TIMEOUT',durationMs:now()-start});throw new DirectoryError('DIRECTORY_UNAVAILABLE',stage==='venues');}
  if(!response.ok){
   report({event:'directory_request',stage,code:'UPSTREAM_ERROR',status:response.status,durationMs:now()-start});
   void response.body?.cancel();throw new DirectoryError(response.status===429?'DIRECTORY_LIMIT':'DIRECTORY_UNAVAILABLE',stage==='venues'&&(response.status===408||response.status===429||response.status>=500));
  }
  try{
   const reader=response.body?.getReader();if(!reader)throw new Error();
   let size=0;const chunks:Uint8Array[]=[];
   for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;
    if(size>1_048_576){await reader.cancel();throw new Error();}chunks.push(item.value);}
   const json:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   report({event:'directory_request',stage,code:'OK',durationMs:now()-start});return json;
  }catch{report({event:'directory_request',stage,code:'INVALID_RESPONSE',durationMs:now()-start});throw new DirectoryError('DIRECTORY_INVALID_RESPONSE');}
 }
 return {async search(raw:unknown,report:(value:Diagnostic)=>void=()=>{},gate?:DirectoryGate){
  const input=venueSearchInput.parse(raw);
  if(!settings.enabled)throw new DirectoryError('DIRECTORY_DISABLED');
  const kind=input.kind??'venue';
  if(kind!=='venue'&&!settings.geoapifyKey)throw new DirectoryError('DIRECTORY_NOT_CONFIGURED');
  const key=input.area.toLocaleLowerCase('en-IN').replace(/\s+/g,' '),resultKey=key+':'+input.radiusKm+':'+kind;
  const cached=results.get(resultKey);if(cached&&cached.expires>now())return cached.result;
  const today=new Date(now()).toISOString().slice(0,10);if(day!==today){day=today;daily=0;}
  if(busy||now()<nextSearch)throw new DirectoryError('DIRECTORY_BUSY');
  if(daily>=50)throw new DirectoryError('DIRECTORY_LIMIT');
  busy=true;nextSearch=now()+1100;
  let lease:string|undefined;
  try{
   if(gate)lease=await gate.reserve();
   daily++;
   let center=centers.get(key)?.expires&&centers.get(key)!.expires>now()?centers.get(key)!.point:undefined;
   if(!center){
    if(settings.geoapifyKey){
     const url=new URL('https://api.geoapify.com/v1/geocode/search');
     url.searchParams.set('text',input.area);url.searchParams.set('limit','1');url.searchParams.set('apiKey',settings.geoapifyKey);
     const response=await request(url.href,'geocode',report);
     const parsed=z.object({features:z.array(z.object({properties:z.object({lat:z.number(),lon:z.number(),formatted:z.string().max(500)})})).max(1)}).safeParse(response);
     if(!parsed.success)throw new DirectoryError('DIRECTORY_INVALID_RESPONSE');
     const first=parsed.data.features[0]?.properties;
     if(!first)throw new DirectoryError('AREA_NOT_FOUND');
     center=point.parse({lat:first.lat,lon:first.lon,display_name:first.formatted});
    }else{
     const url=new URL(settings.geocoderUrl);url.searchParams.set('q',input.area);url.searchParams.set('format','jsonv2');url.searchParams.set('limit','1');
     const response=await request(url.href,'geocode',report);
     const parsed=point.array().max(1).safeParse(response);
     if(!parsed.success)throw new DirectoryError('DIRECTORY_INVALID_RESPONSE');
     center=parsed.data[0];if(!center)throw new DirectoryError('AREA_NOT_FOUND');
    }
    centers.set(key,{expires:now()+86400000,point:center});prune(centers,100);
   }
   const query='[out:json][timeout:12];nwr(around:'+input.radiusKm*1000+','+center.lat+','+center.lon+')['+
    '"amenity"~"^(events_venue|community_centre|arts_centre|theatre|conference_centre)$"]["name"];out center tags 50;';
   const body=new URLSearchParams({data:query}).toString();
   let response:unknown;
   if(settings.geoapifyKey){
    const url=new URL('https://api.geoapify.com/v2/places');
    const categories=kind==='venue'?'activity.events_venue,activity.community_center,entertainment.culture.arts_centre,entertainment.culture.theatre,tourism.sights.conference_centre':kind==='food'?'catering.restaurant,catering.cafe':'rental,commercial.elektronics';
    url.searchParams.set('categories',categories);
    url.searchParams.set('filter','circle:'+center.lon+','+center.lat+','+input.radiusKm*1000);
    url.searchParams.set('bias','proximity:'+center.lon+','+center.lat);
    url.searchParams.set('limit','20');
    url.searchParams.set('apiKey',settings.geoapifyKey);
    const raw=await request(url.href,'venues',report);
    const parsedGeo=z.object({features:z.array(z.object({properties:z.object({
     name:z.string().optional(),lat:z.number(),lon:z.number(),formatted:z.string().optional(),
     datasource:z.object({raw:z.object({osm_type:z.union([z.string(),z.number()]),osm_id:z.union([z.string(),z.number()]),capacity:z.union([z.string(),z.number()]).optional(),wheelchair:z.string().optional()})}).optional(),
    })})).max(20)}).safeParse(raw);
    if(!parsedGeo.success)throw new DirectoryError('DIRECTORY_INVALID_RESPONSE');
    const elements=parsedGeo.data.features.flatMap(({properties:p})=>{
     const source=p.datasource?.raw,type=source?.osm_type;
     const resolved=type==='n'||type==='node'?'node':type==='w'||type==='way'?'way':type==='r'||type==='relation'?'relation':null;
     const id=Number(source?.osm_id);
     if(!resolved||!Number.isSafeInteger(id)||id<=0||!p.name)return [];
     return [{type:resolved,id,lat:p.lat,lon:p.lon,tags:{name:p.name,'addr:city':p.formatted??'',capacity:String(source?.capacity??''),wheelchair:source?.wheelchair??''}}];
    });
    response={elements};
   }else{
    try{response=await request(settings.overpassUrl,'venues',report,body);}
    catch(error){
     if(!(error instanceof DirectoryError)||!error.transient||settings.overpassUrl==='https://overpass.private.coffee/api/interpreter')throw error;
     response=await request('https://overpass.private.coffee/api/interpreter','venues',report,body);
    }
   }
   const parsed=z.object({elements:z.array(element).max(50),remark:z.string().optional()}).safeParse(response);
   if(!parsed.success||parsed.data.remark)throw new DirectoryError('DIRECTORY_INVALID_RESPONSE');
   const seen=new Set<string>();const venues:Venue[]=[];
   for(const place of parsed.data.elements){
    const latitude=place.lat??place.center?.lat,longitude=place.lon??place.center?.lon;
    if(latitude===undefined||longitude===undefined||Math.abs(latitude)>90||Math.abs(longitude)>180||!place.tags.name?.trim())continue;
    const distanceKm=distance(center.lat,center.lon,latitude,longitude);
    if(distanceKm>input.radiusKm+.1)continue;
    const id=place.type+':'+place.id;if(seen.has(id))continue;seen.add(id);
    const rawCapacity=place.tags.capacity??'';
    const capacity=/^[0-9]{1,6}$/.test(rawCapacity)?Number(rawCapacity):0;
    venues.push({id,name:place.tags.name.trim().slice(0,300),
     address:[place.tags['addr:housenumber'],place.tags['addr:street'],place.tags['addr:suburb'],place.tags['addr:city']].filter(Boolean).join(', ').slice(0,500),
     distanceKm:Math.round(distanceKm*10)/10,capacity:capacity>0&&capacity<=100000?capacity:null,
     wheelchair:['yes','limited','no'].includes(place.tags.wheelchair)?place.tags.wheelchair as Venue['wheelchair']:'unknown',
     sourceUrl:'https://www.openstreetmap.org/'+place.type+'/'+place.id,
    });
   }
   const result=venueSearchResponse.parse({area:center.display_name,radiusKm:input.radiusKm,
    venues:venues.sort((a,b)=>a.distanceKm-b.distanceKm||a.id.localeCompare(b.id)).slice(0,12),
    attribution:'© OpenStreetMap contributors — ODbL'});
   results.set(resultKey,{expires:now()+900000,result});prune(results,64);return result;
  }finally{
    if(gate&&lease){try{await gate.release(lease);}catch{report({event:'directory_request',stage:'venues',code:'GATE_RELEASE_FAILED',durationMs:0});}}
   busy=false;nextSearch=Math.max(nextSearch,now()+1100);
  }
 }};
}
function distance(lat1:number,lon1:number,lat2:number,lon2:number){
 const radians=(value:number)=>value*Math.PI/180;
 const a=Math.sin(radians(lat2-lat1)/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(radians(lon2-lon1)/2)**2;
 return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
}
