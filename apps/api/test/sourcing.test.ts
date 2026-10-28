import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectory, defaultDirectorySettings } from '../src/sourcing/directory.ts';
test('directory resolves public areas, filters mapped results and reuses cache',async()=>{
 let calls=0;
 const service=createDirectory(defaultDirectorySettings,async()=>{
  calls++;
  return new Response(JSON.stringify(calls===1?[{lat:'17.4',lon:'78.4',display_name:'Fixture city'}]:
   {elements:[{type:'node',id:1,lat:17.4,lon:78.4,tags:{name:'Fixture hall',capacity:'100'}}]}));
 });
 const first=await service.search({area:'Fixture city',radiusKm:10});
 assert.equal(first.venues[0].name,'Fixture hall');
 assert.equal(first.venues[0].capacity,100);
 assert.equal(first.venues[0].wheelchair,'unknown');
 await service.search({area:'Fixture city',radiusKm:10});
 assert.equal(calls,2);
});
test('distinct area names cannot collide and whitespace variants reuse the same cache',async()=>{
 let time=100000,geocodes=0;
 const service=createDirectory(defaultDirectorySettings,async input=>{
  const url=new URL(String(input));
  if(url.pathname.includes('search')){
   geocodes++;
   return new Response(JSON.stringify([{lat:'17.4',lon:'78.4',display_name:url.searchParams.get('q')}]));
  }
  return new Response(JSON.stringify({elements:[]}));
 },()=>time);
 assert.equal((await service.search({area:'Bas',radiusKm:10})).area,'Bas');
 time+=2000;
 assert.equal((await service.search({area:'Bass',radiusKm:10})).area,'Bass');
 time+=2000;
 assert.equal((await service.search({area:'North  City',radiusKm:10})).area,'North  City');
 assert.equal((await service.search({area:'north city',radiusKm:10})).area,'North  City');
 assert.equal(geocodes,3);
});
test('directory does not invent venues when upstream fails or area is absent',async()=>{
 const unavailable=createDirectory(defaultDirectorySettings,async()=>new Response('private details',{status:503}));
 await assert.rejects(()=>unavailable.search({area:'Fixture',radiusKm:5}),/DIRECTORY_UNAVAILABLE/);
 const missing=createDirectory(defaultDirectorySettings,async()=>new Response('[]'));
 await assert.rejects(()=>missing.search({area:'Missing',radiusKm:5}),/AREA_NOT_FOUND/);
});

test('venue lookup falls back once after a transient failure, without repeating geocoding',async()=>{
 const urls:string[]=[];
 const service=createDirectory(defaultDirectorySettings,async(input)=>{
  urls.push(String(input));
  if(urls.length===1)return new Response(JSON.stringify([{lat:'17.4',lon:'78.4',display_name:'Fixture city'}]));
  if(urls.length===2)return new Response('',{status:502});
  return new Response(JSON.stringify({elements:[{type:'node',id:2,lat:17.4,lon:78.4,tags:{name:'Hall'}}]}));
 });
 const result=await service.search({area:'Fixture city',radiusKm:10});
 assert.equal(result.venues[0].name,'Hall');
 assert.equal(urls.length,3);
 assert.equal(urls[2],'https://overpass.private.coffee/api/interpreter');
});
test('venue lookup does not fall back on invalid requests',async()=>{
 let count=0;
 const service=createDirectory(defaultDirectorySettings,async()=>{
  count++;
  return count===1?new Response(JSON.stringify([{lat:'17.4',lon:'78.4',display_name:'Fixture'}])):new Response('',{status:400});
 });
 await assert.rejects(()=>service.search({area:'Fixture',radiusKm:5}),/DIRECTORY_UNAVAILABLE/);
 assert.equal(count,2);
});

test('Geoapify venues use the configured key server-side and preserve OSM identifiers',async()=>{
 const urls:string[]=[];
 const service=createDirectory({...defaultDirectorySettings,geoapifyKey:'fixture-secret'},async(input)=>{
  urls.push(String(input));
  return urls.length===1?new Response(JSON.stringify({features:[{properties:{lat:17.4,lon:78.4,formatted:'Fixture city'}}]})):
   new Response(JSON.stringify({features:[{properties:{name:'Community hall',lat:17.4,lon:78.4,formatted:'Test address',datasource:{raw:{osm_type:'n',osm_id:123,capacity:150}}}},{properties:{name:'Unidentified',lat:17.4,lon:78.4}}]}));
 });
 const result=await service.search({area:'Fixture city',radiusKm:10});
 assert.equal(result.venues.length,1);
 assert.equal(result.venues[0].id,'node:123');
 assert.equal(result.venues[0].capacity,150);
 assert.ok(urls[1].startsWith('https://api.geoapify.com/v2/places?'));
});

test('supplier leads use the requested Geoapify category and do not share venue cache',async()=>{
 const urls:string[]=[];let time=100000;
 const service=createDirectory({...defaultDirectorySettings,geoapifyKey:'fixture-secret'},async input=>{
  urls.push(String(input));
  if(urls.length===1)return new Response(JSON.stringify({features:[{properties:{lat:17.4,lon:78.4,formatted:'Fixture city'}}]}));
  return new Response(JSON.stringify({features:[{properties:{name:'Mapped business',lat:17.4,lon:78.4,datasource:{raw:{osm_type:'n',osm_id:123}}}}]}));
 },()=>time);
 assert.equal((await service.search({area:'Fixture city',radiusKm:10,kind:'food'})).venues[0].name,'Mapped business');
 assert.ok(new URL(urls[1]).searchParams.get('categories')?.includes('catering.restaurant'));
 time+=2000;
 await service.search({area:'Fixture city',radiusKm:10,kind:'venue'});
 assert.equal(urls.length,3);
 assert.ok(new URL(urls[2]).searchParams.get('categories')?.includes('activity.events_venue'));
 await service.search({area:'Fixture city',radiusKm:10,kind:'food'});
 assert.equal(urls.length,3);
 const noKey=createDirectory(defaultDirectorySettings,async()=>{throw new Error('Should not request');});
 await assert.rejects(()=>noKey.search({area:'Fixture city',radiusKm:10,kind:'equipment'}),/DIRECTORY_NOT_CONFIGURED/);
});

test('directory gate blocks upstream calls on denial and releases leases on success and failure',async()=>{
 let upstream=0,releases=0,time=100000;
 const fetcher:typeof fetch=async()=>{
  upstream++;
  return upstream===1?new Response(JSON.stringify([{lat:'17.4',lon:'78.4',display_name:'Fixture city'}])):
   new Response(JSON.stringify({elements:[]}));
 };
 const service=createDirectory(defaultDirectorySettings,fetcher,()=>time);
 await assert.rejects(()=>service.search({area:'First area',radiusKm:10},()=>{}, {reserve:async()=>{throw new Error('gate unavailable');},release:async()=>{releases++;}}));
 assert.equal(upstream,0);assert.equal(releases,0);
 time+=2000;
 await service.search({area:'First area',radiusKm:10},()=>{},{reserve:async()=> 'lease',release:async id=>{assert.equal(id,'lease');releases++;}});
 assert.equal(upstream,2);assert.equal(releases,1);
 time+=2000;
 const failed=createDirectory(defaultDirectorySettings,async()=>new Response('',{status:503}),()=>time);
 await assert.rejects(()=>failed.search({area:'Other area',radiusKm:10},()=>{},{reserve:async()=> 'lease',release:async()=>{releases++;}}));
 assert.equal(releases,2);
});
