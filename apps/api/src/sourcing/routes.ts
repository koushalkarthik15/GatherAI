import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { venueSearchInput } from '@gather/core/sourcing';
import type { Config } from '../config.ts';
import { ApiError, type Repository } from '../repository.ts';
import { createDirectoryGate } from './gate.ts';
import { createDirectory, defaultDirectorySettings, DirectoryError, type Directory } from './directory.ts';
export function registerSourcingRoutes(app:FastifyInstance,config:Config,repository:(request:FastifyRequest)=>Repository,directory?:Directory){
 const service=directory??createDirectory({
  geoapifyKey:config.GEOAPIFY_API_KEY,
  geocoderUrl:config.NOMINATIM_URL??defaultDirectorySettings.geocoderUrl,
  overpassUrl:config.OVERPASS_URL??defaultDirectorySettings.overpassUrl,enabled:config.DIRECTORY_ENABLED!=='false',
 });
 app.post('/api/events/:id/venues',async request=>{
  const {id}=z.object({id:z.uuid()}).parse(request.params);
  const input=venueSearchInput.parse(request.body);
  const plan=await repository(request).get(request.headers.authorization!.slice(7),id);
  if(!plan)throw new ApiError(404,'NOT_FOUND','Event not found.');
  try{return await service.search(input,value=>request.log.info(value,'Directory request completed'),createDirectoryGate(config,request.headers.authorization!.slice(7)));}
  catch(error){
   if(!(error instanceof DirectoryError))throw error;
   const messages:Record<string,string>={
    AREA_NOT_FOUND:'That city or area was not found. Add the city, state and country, then search again.',
    DIRECTORY_GATE_UNAVAILABLE:'Directory coordination is unavailable. Try later or add a source manually.',
    DIRECTORY_BUSY:'A directory request is already running. Wait a few seconds and search again.',
    DIRECTORY_LIMIT:'The directory search limit is reached. You can still add sources manually or use the external map search.',
    DIRECTORY_NOT_CONFIGURED:'Food and equipment searches require GEOAPIFY_API_KEY in apps/api/.env. Restart the API after configuring it.',
    DIRECTORY_DISABLED:'Live directory search is disabled. Use the external search or add a source manually.',
    DIRECTORY_INVALID_RESPONSE:'The directory returned an incomplete response. Try later or add a source manually.',
    DIRECTORY_UNAVAILABLE:'The venue directory is unavailable. Try later or use the external map search.',
   };
   throw new ApiError(error.code==='DIRECTORY_LIMIT'?429:error.code==='DIRECTORY_BUSY'?409:error.code==='AREA_NOT_FOUND'?404:503,
    error.code,messages[error.code]??messages.DIRECTORY_UNAVAILABLE);
  }
 });
}
