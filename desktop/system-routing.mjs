import http from 'node:http';
import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,X509Certificate} from 'node:crypto';
import {enabledHosts,validatePolicy} from '../shared/providers.mjs';
const run=promisify(execFile);
export function selectivePac(policy,port,{active=true}={}){
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Puerto PAC inválido.');
  const hosts=active?enabledHosts(policy):[];
  // HTTPS paths are stripped by Chrome before calling FindProxyForURL.
  // Domain routing and human-prompt extraction are separate security boundaries.
  return `function FindProxyForURL(url, host) {\n  host = host.toLowerCase();\n  var hosts = ${JSON.stringify(hosts)};\n  if (/^https:\\/\\//i.test(url)) {\n    for (var i = 0; i < hosts.length; i++) {\n      if (host === hosts[i]) return "PROXY 127.0.0.1:${port}; DIRECT";\n    }\n  }\n  return "DIRECT";\n}\n`;
}
export class SystemRouting{
  constructor({directory,helper,policy,port=11441,proxyPort=11442,pid=process.pid,uid=process.getuid?.(),platform=process.platform}){
    this.directory=directory;this.helper=helper;this.policy=validatePolicy(policy);this.port=port;this.proxyPort=proxyPort;this.pid=pid;this.uid=uid;this.platform=platform;
    this.id=randomUUID();this.server=null;this.timer=null;this.desired=false;this.requested=false;this.serial=Promise.resolve();this.error=null;this.closed=false;this.authorized=false;this.requestedAt=null;
  }
  get pacUrl(){return `http://127.0.0.1:${this.port}/${this.id}/proxy.pac?revision=${this.policy.revision}`;}
  get statusPath(){return `/Library/Application Support/Usovia/BrowserSessions/${this.id}/status.json`;}
  async status(){let helper=null;try{helper=JSON.parse(await readFile(this.statusPath,'utf8'));}catch{}
    // Expired status cannot falsely claim coverage after a killed native helper.
    const fresh=helper&&Date.now()-helper.at<8000;if(fresh)this.authorized=true;
    return {supported:this.platform==='darwin',requested:this.requested,desired:this.desired,active:!!(this.desired&&fresh&&helper.phase==='active'&&helper.active&&helper.effective),phase:fresh?helper.phase:this.requested&&(this.authorized||this.requestedAt&&Date.now()-this.requestedAt>180000)?'helper_unavailable':this.requested?'awaiting_authorization':'off',services:fresh?helper.services||[]:[],skippedServices:fresh?helper.skippedServices||[]:[],configured:!!(fresh&&helper.active),error:this.error||(fresh?helper.error:null),pacUrl:this.server?this.pacUrl:null};
  }
  async start(){
    if(this.platform!=='darwin')throw new Error('La integración de navegadores del sistema está disponible en macOS.');
    if(this.server)return;
    await mkdir(this.directory,{recursive:true,mode:0o700});await chmod(this.directory,0o700);
    const server=http.createServer((req,res)=>{
      if(req.method!=='GET'||!new RegExp(`^/${this.id}/proxy\\.pac(?:\\?revision=[0-9]+)?$`).test(req.url||'')||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.origin){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/x-ns-proxy-autoconfig','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(selectivePac(this.policy,this.proxyPort,{active:this.desired}));
    });
    this.server=server;server.headersTimeout=5000;server.requestTimeout=5000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'127.0.0.1',()=>{server.off('error',reject);this.port=server.address().port;resolve();});}).catch(e=>{this.server=null;throw e;});
    await this.writeLease();this.timer=setInterval(()=>this.writeLease().catch(e=>{this.error=e.message;}),2000);this.timer.unref();
  }
  writeLease(){const operation=async()=>{const file=join(this.directory,`${this.id}.lease.json`);await writeFile(file+'.tmp',JSON.stringify({id:this.id,pid:this.pid,at:Date.now(),active:this.desired,closed:this.closed,revision:this.policy.revision}),{mode:0o600});await rename(file+'.tmp',file);};this.serial=this.serial.catch(()=>{}).then(operation);return this.serial;}
  async setActive(value){this.desired=!!value;await this.writeLease();}
  async updatePolicy(policy){const next=validatePolicy(policy);if(next.revision<this.policy.revision)throw new Error('Política anterior rechazada.');this.policy=next;}
  async prepare(authority){
    await this.start();const cert=new X509Certificate(authority.cert);
    if(!cert.ca||!cert.verify(cert.publicKey))throw new Error('CA local inválida.');
    const manifest={version:1,id:this.id,uid:this.uid,pid:this.pid,createdAt:Date.now(),leasePath:join(this.directory,`${this.id}.lease.json`),pacUrl:this.pacUrl,certificate:cert.raw.toString('base64'),sha256:cert.fingerprint256.replaceAll(':','').toLowerCase()};
    const path=join(this.directory,`${this.id}.manifest.json`);await writeFile(path,JSON.stringify(manifest),{mode:0o600});
    this.requested=true;this.requestedAt=Date.now();return {path,fingerprint:cert.fingerprint256,pacUrl:this.pacUrl};
  }
  launchAuthorization(args){
    // Native Authorization Services, fixed binary + argument vector. No shell,
    // Terminal, stored password or private CA material in the root process.
    return new Promise((resolve,reject)=>{const child=spawn(this.helper,args,{stdio:['ignore','ignore','pipe'],windowsHide:true});let message='';child.stderr.on('data',c=>{if(message.length<2000)message+=c.toString();});child.once('error',reject);child.once('exit',code=>code===0?resolve({authorization:'started'}):reject(new Error(message.trim()||'La autorización de macOS no se completó.')));});
  }
  async authorize(plan){return this.launchAuthorization(['authorize',plan.path]);}
  async authorizeRecovery(){return this.launchAuthorization(['authorize-recovery']);}
  async inspect(){const result=await run(this.helper,['inspect'],{timeout:10000,maxBuffer:65536});return JSON.parse(result.stdout);}
  async stop(){this.desired=false;this.closed=true;if(this.server)await this.writeLease();clearInterval(this.timer);this.timer=null;for(let i=0;i<8;i++){let helper;try{helper=JSON.parse(await readFile(this.statusPath,'utf8'));}catch{}if(!helper||helper.phase==='stopped'||Date.now()-helper.at>8000)break;await new Promise(r=>setTimeout(r,500));}const server=this.server;this.server=null;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
}
