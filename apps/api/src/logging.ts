import type { FastifyServerOptions } from 'fastify';
export const safeLogger:FastifyServerOptions['logger']={
 level:'info',
 redact:{paths:['req.headers','req.body','res.headers','headers','body','token','password','err'],remove:true},
 serializers:{
  req(request){return {method:request.method};},
  res(response){return {statusCode:response.statusCode};},
 },
};
