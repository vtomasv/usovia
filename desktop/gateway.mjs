import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream';
import {ResponseCapture,requestContext} from './conversations.mjs';
const MAX_INSPECT=1024*1024;
const cleanHeaders=headers=>{const out={...headers};for(const key of ['connection','keep-alive','transfer-encoding','upgrade','te','trailer','proxy-authenticate','proxy-authorization'])delete out[key];for(const key of String(headers.connection||'').split(','))delete out[key.trim().toLowerCase()];return out;};
export class LocalGateway{
  constructor({controller,runtimeUrl,onChange,port=11436}){this.controller=controller;this.runtimeUrl=runtimeUrl;this.onChange=onChange;this.server=null;this.sockets=new Set();this.active=new Set();this.port=port;this.key=randomBytes(32).toString('base64url');}
  async start(){
    if(this.server)return;
    const server=createServer(async(req,res)=>{
      const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
      if(req.headers.origin)return reply(403,{error:'Usa el chat de Usovia o una aplicación API configurada.'});
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return reply(403,{error:'Solo conexiones locales.'});
      const parsed=new URL(req.url,'http://localhost'),path=parsed.pathname;
      if(path==='/health')return reply(200,{active:true,mode:'observe',channels:['api/chat','api/generate','v1/chat/completions']});
      const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(this.key);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply(401,{error:'Configura la clave de la API local de Usovia.'});
      if(path==='/v1/models'||path==='/api/tags'){
        try{const response=await fetch(this.runtimeUrl+path);return reply(response.status,await response.json());}catch{return reply(503,{error:'El motor local todavía no está listo.'});}
      }
      if(req.method!=='POST'||!['/api/chat','/api/generate','/v1/chat/completions'].includes(path))return reply(404,{error:'Canal no disponible.'});
      if(!this.controller.state.consent.capture)return reply(503,{error:'La conexión gobernada está pausada. Usa el motor local directamente.'});
      const epoch=this.controller.generation,abort=new AbortController();this.active.add(abort);
      req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableFinished)abort.abort();});
      let chunks=[],length=0,inspect=true,turn,tap,releaseTap,upstreamStatus=null,finished=false;
      const finish=async(aborted=false)=>{if(finished)return;finished=true;try{if(turn)await this.controller.finishTurn(turn,tap?await tap.finish({aborted}):{status:upstreamStatus>=400?'error':aborted?'aborted':'not_authorized',text:''},upstreamStatus);this.onChange?.();}catch{/* Observation must never fail inference. */}finally{releaseTap?.();this.active.delete(abort);}};
      req.on('data',chunk=>{if(!inspect)return;length+=chunk.length;if(length>MAX_INSPECT){inspect=false;chunks=[];}else chunks.push(chunk);});
      req.once('end',()=>{
        try{
          if(!inspect||req.headers['content-encoding']||epoch!==this.controller.generation||!this.controller.beginTurn)return;
          const raw=Buffer.concat(chunks,length).toString('utf8'),body=JSON.parse(raw);chunks=[];
          if(!body||typeof body!=='object'||Array.isArray(body)||body.messages&&!Array.isArray(body.messages))return;
          const user=(body.messages||[]).filter(m=>m?.role==='user').at(-1),prompt=typeof body.prompt==='string'?body.prompt:typeof user?.content==='string'?user.content:'';
          if(!prompt.trim())return;
          const context=requestContext({adapter:'messages'},raw,'application/json');context.explicitId=req.headers['x-usovia-conversation'];
          turn=this.controller.beginTurn({prompt:prompt.slice(0,12000),promptTruncated:prompt.length>12000,provider:'ollama',model:typeof body.model==='string'?body.model.slice(0,70):'',channel:req.headers['x-usovia-channel']==='chat_usovia'?'chat_usovia':'gateway_api'},context);
        }catch{/* The runtime validates original JSON and media; no observation denial. */}
      });
      try{
        const url=new URL(this.runtimeUrl+path+parsed.search),headers={'Content-Type':req.headers['content-type']||'application/json',...(req.headers['content-length']?{'Content-Length':req.headers['content-length']}:{}),...(req.headers['content-encoding']?{'Content-Encoding':req.headers['content-encoding']}: {})};
        const upstream=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'POST',headers,signal:abort.signal},response=>{
          upstreamStatus=response.statusCode;
          if(turn&&epoch===this.controller.generation&&this.controller.state.consent.captureResponses){tap=new ResponseCapture({onIdentity:identity=>this.controller.sessions.bindIdentity(turn,identity),adapter:path==='/v1/chat/completions'?'messages':'ollama',type:response.headers['content-type']||'application/json',encoding:response.headers['content-encoding'],httpStatus:response.statusCode});releaseTap=this.controller.observeResponse(tap);response.on('data',chunk=>{if(epoch===this.controller.generation)tap.add(chunk);});}
          response.once('end',()=>finish());response.once('aborted',()=>finish(true));response.once('error',()=>finish(true));
          res.writeHead(response.statusCode,cleanHeaders(response.headers));pipeline(response,res,()=>{});
        });
        upstream.setTimeout(180000,()=>upstream.destroy());
        upstream.once('error',()=>{if(!res.headersSent&&!res.destroyed)reply(abort.signal.aborted?503:502,{error:abort.signal.aborted?'Solicitud cancelada.':'No se pudo conectar con el motor local.'});else res.destroy();finish(true);});
        pipeline(req,upstream,()=>{});
      }catch{if(!res.headersSent)reply(502,{error:'No se pudo conectar con el motor local.'});finish(true);}
    });
    server.on('connection',socket=>{this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'127.0.0.1',resolve);});this.server=server;
  }
  async stop(){for(const c of this.active)c.abort();this.active.clear();for(const socket of this.sockets)socket.destroy();if(this.server){const server=this.server;this.server=null;await new Promise(resolve=>server.close(resolve));}}
}
