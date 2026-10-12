import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {lookup} from 'node:dns/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream';
import {enabledHosts,matchEndpoint,extractPrompt,validatePolicy} from '../shared/providers.mjs';
import {issueLeaf} from './certificate.mjs';
import {ResponseCapture,requestContext} from './conversations.mjs';
const MAX_BODY=1024*1024;
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
export function publicAddress(address){
  const kind=net.isIP(address);if(kind===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224);}
  if(kind===6)return !(/^(::|fc|fd|fe8|fe9|fea|feb)/i.test(address));return false;
}
const resolvePublic=async host=>{const addresses=await lookup(host,{all:true});const address=addresses.find(a=>publicAddress(a.address));if(!address)throw new Error('Destino no público.');return address;};
const cleanHeaders=headers=>{const result={...headers};const hop=['connection','proxy-connection','proxy-authorization','keep-alive','upgrade','te','trailer','transfer-encoding'];for(const x of String(headers.connection||'').split(','))hop.push(x.trim().toLowerCase());for(const x of hop)delete result[x];return result;};
export class LlmProxy{
  constructor({controller,authority,policy,onChange=()=>{},port=11440,resolve=resolvePublic,upstreamPort=443,upstreamCA,key,systemBrowser=false}){
    this.controller=controller;this.authority=authority;this.policy=validatePolicy(policy);this.routedHosts=new Set(enabledHosts(this.policy));this.onChange=onChange;this.port=port;this.resolve=resolve;this.upstreamPort=upstreamPort;this.upstreamCA=upstreamCA;
    if(key!==undefined&&(typeof key!=='string'||! /^[A-Za-z0-9_-]{40,128}$/.test(key)))throw new Error('Clave de proxy inválida.');
    this.systemBrowser=systemBrowser;
    this.key=key||randomBytes(32).toString('base64url');this.server=null;this.sockets=new Set();this.inner=new Map();this.innerTimes=new Map();this.stats={inspected:0,captured:0,tunneled:0,unsupported:0};this.epoch=0;
  }
  get hosts(){return enabledHosts(this.policy);}
  get url(){return `http://usovia:${this.key}@127.0.0.1:${this.port}`;}
  authenticated(req){return equal(req.headers['proxy-authorization'],'Basic '+Buffer.from('usovia:'+this.key).toString('base64'));}
  track(socket){this.sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>this.sockets.delete(socket));return socket;}
  resetConnections(){this.epoch++;for(const socket of this.sockets)socket.destroy();this.sockets.clear();for(const server of this.inner.values())Promise.resolve(server).then(s=>s.closeAllConnections());this.inner.clear();this.innerTimes.clear();}
  async applyPolicy(policy){const next=validatePolicy(policy);for(const host of enabledHosts(next))this.routedHosts.add(host);this.policy=next;this.resetConnections();}
  async start(){
    if(this.server)return;
    const server=http.createServer({maxHeaderSize:65536},(_req,res)=>{res.writeHead(405);res.end('Usovia admite túneles HTTPS.');});
    this.server=server;server.maxHeadersCount=100;server.headersTimeout=15000;server.requestTimeout=30000;
    server.on('connection',socket=>this.track(socket));server.on('clientError',(_err,socket)=>socket.destroy());
    server.on('connect',(req,socket,head)=>{this.connect(req,socket,head).catch(()=>socket.destroy());});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'127.0.0.1',()=>{server.off('error',reject);this.port=server.address().port;resolve();});}).catch(e=>{this.server=null;throw e;});
  }
  async connect(req,socket,head){
    // PAC has no credential mechanism. The separately enabled browser listener is
    // loopback-only and accepts only registered LLM hosts, never a general relay.
    if(!this.systemBrowser&&!this.authenticated(req)){socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Usovia"\r\nConnection: close\r\n\r\n');return;}
    if(!this.controller.state.consent.capture||this.sockets.size>64){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
    const match=/^([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):443$/.exec(req.url||'');if(!match){socket.destroy();return;}
    const hostname=match[1].toLowerCase(),epoch=this.epoch;socket.pause();
    if(this.systemBrowser&&!this.hosts.includes(hostname)&&!this.routedHosts.has(hostname)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    if(!this.hosts.includes(hostname)){
      // A browser may retain the previous PAC. Previously routed LLM hosts are
      // relayed as opaque TLS after exclusion, without decrypting or observing.
      // Unknown hosts remain forbidden on the system listener.
      const address=await this.resolve(hostname);if(epoch!==this.epoch||socket.destroyed)return;
      const upstream=this.track(net.connect({host:address.address,family:address.family,port:this.upstreamPort}));upstream.setTimeout(120000,()=>upstream.destroy());
      upstream.once('connect',()=>{if(socket.destroyed){upstream.destroy();return;}this.stats.tunneled++;socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.resume();socket.pipe(upstream).pipe(socket);});
      upstream.on('error',()=>socket.destroy());socket.once('close',()=>upstream.destroy());upstream.once('close',()=>socket.destroy());return;
    }
    if(Date.now()-(this.innerTimes.get(hostname)||0)>12*3600000)this.inner.delete(hostname);
    if(!this.inner.has(hostname)){this.innerTimes.set(hostname,Date.now());this.inner.set(hostname,issueLeaf(this.authority,hostname).then(leaf=>{
      const server=https.createServer({...leaf,maxHeaderSize:65536,minVersion:'TLSv1.2',ALPNProtocols:['http/1.1']},(req,res)=>this.forward(hostname,req,res));
      server.maxHeadersCount=100;server.headersTimeout=15000;server.requestTimeout=30000;
      server.on('tlsClientError',()=>{});server.on('clientError',(_err,socket)=>socket.destroy());return server;
    }));}
    const inner=await this.inner.get(hostname);if(epoch!==this.epoch||socket.destroyed||!this.hosts.includes(hostname))return socket.destroy();
    this.stats.inspected++;socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)socket.unshift(head);inner.emit('connection',socket);socket.resume();
  }
  async forward(hostname,req,res){
    const epoch=this.epoch,consentVersion=this.controller.state.consentVersion;
    let path;try{if(!req.url.startsWith('/')||req.url.startsWith('//'))throw new Error();path=new URL(req.url,'https://'+hostname);if(path.hostname!==hostname||req.headers.host?.split(':')[0]!==hostname)throw new Error();}catch{res.writeHead(400);res.end();return;}
    if(!this.controller.state.consent.capture||!this.hosts.includes(hostname)){res.destroy();return;}
    const endpoint=matchEndpoint(this.policy,hostname,path.pathname,req.method);
    // Non-generation routes on a selected host are forwarded but never inspected for text.
    let chunks=[],length=0,inspect=!!endpoint&&!req.headers['content-encoding']&&Number(req.headers['content-length']||0)<=MAX_BODY;
    let upstream;
    try{
      const address=await this.resolve(hostname);if(epoch!==this.epoch||req.destroyed)return;
      upstream=https.request({hostname,port:this.upstreamPort,maxHeaderSize:65536,path:req.url,method:req.method,headers:cleanHeaders(req.headers),servername:hostname,rejectUnauthorized:true,...(this.upstreamCA?{ca:this.upstreamCA}:{}),lookup:(_host,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family),agent:false},reply=>{
        if(epoch!==this.epoch||!this.controller.state.consent.capture){reply.destroy();res.destroy();return;}
        let turn,tap,releaseTap,finished=false;
        try{if(inspect){const raw=Buffer.concat(chunks,length).toString('utf8'),type=String(req.headers['content-type']||'');const extracted=extractPrompt(endpoint,raw,type);chunks=[];
          if(extracted&&consentVersion===this.controller.state.consentVersion){
            this.stats.captured++;
            turn=this.controller.beginTurn({...extracted,provider:endpoint.provider,channel:endpoint.channel},requestContext(endpoint,raw,type));
            if(this.controller.state.consent.captureResponses)tap=new ResponseCapture({onIdentity:identity=>this.controller.sessions.bindIdentity(turn,identity),adapter:endpoint.adapter,type:String(reply.headers['content-type']||''),encoding:reply.headers['content-encoding'],httpStatus:reply.statusCode});
          }else this.stats.unsupported++;
        }
        }catch{this.stats.unsupported++;turn=null;}
        if(tap)releaseTap=this.controller.observeResponse(tap);
        const finish=async(aborted=false)=>{if(finished||!turn)return;finished=true;try{const result=tap?await tap.finish({aborted}):{text:'',status:reply.statusCode>=400?'error':'not_authorized'};if(epoch===this.epoch&&consentVersion===this.controller.state.consentVersion)await this.controller.finishTurn(turn,result,reply.statusCode);this.onChange();}catch{/* Never fail the original stream because telemetry failed. */}finally{releaseTap?.();}};
        if(tap)reply.on('data',c=>{if(epoch===this.epoch&&consentVersion===this.controller.state.consentVersion)tap.add(c);});
        reply.once('end',()=>finish());reply.once('aborted',()=>finish(true));reply.once('error',()=>finish(true));
        res.writeHead(reply.statusCode,cleanHeaders(reply.headers));pipeline(reply,res,()=>{});

      });
      upstream.on('socket',s=>this.track(s));upstream.setTimeout(120000,()=>upstream.destroy());
      upstream.on('error',error=>{this.stats.lastError=error.code||'UPSTREAM_ERROR';this.onChange();if(!res.headersSent){res.writeHead(502);res.end('No se pudo validar o conectar con el proveedor.');}else res.destroy();});
      req.once('aborted',()=>upstream.destroy());res.once('close',()=>{if(!res.writableFinished)upstream.destroy();});
      req.on('data',chunk=>{if(inspect){length+=chunk.length;if(length<=MAX_BODY)chunks.push(chunk);else{inspect=false;chunks=[];}}});
      pipeline(req,upstream,()=>{});
    }catch{res.writeHead(502);res.end('Proveedor no disponible.');}
  }
  async stop(){const server=this.server;this.server=null;this.resetConnections();if(server)await new Promise(resolve=>server.close(resolve));}
}
