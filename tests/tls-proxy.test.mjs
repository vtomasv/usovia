import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {generateAuthority,issueLeaf,verifyEndpointCertificate} from '../desktop/certificate.mjs';
import {LlmProxy,publicAddress} from '../desktop/tls-proxy.mjs';
import {defaultPolicy} from '../shared/providers.mjs';
import {ClientController,initialClient} from '../desktop/controller.mjs';
import {gzipSync} from 'node:zlib';
const root=await generateAuthority();
async function setup(t,{trusted=true,largeHeaders=false,responsePayload=null,compressed=false}={}){
  const leaf=await issueLeaf(root,'api.openai.com');let observed=[];
  const origin=https.createServer(leaf,(req,res)=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>{observed.push({headers:req.headers,text});if(responsePayload){const bytes=compressed?gzipSync(Buffer.from(responsePayload)):Buffer.from(responsePayload);res.writeHead(200,{'Content-Type':'text/event-stream','Content-Length':bytes.length,...(compressed?{'Content-Encoding':'gzip'}:{})});res.write(bytes.subarray(0,8));setTimeout(()=>res.end(bytes.subarray(8)),20);return;}res.writeHead(200,{'Content-Type':'text/event-stream',...(largeHeaders?{'Content-Security-Policy':'script-src '+ 'https://synthetic.example '.repeat(1000)}:{})});res.write('data: {"text":"ok"}\n\n');setTimeout(()=>res.end('data: [DONE]\n\n'),20);});});
  await new Promise(r=>origin.listen(0,'127.0.0.1',r));
  const state=initialClient();state.token='synthetic';state.consent={capture:true,shareText:true,reportStatus:false};state.consentVersion=1;
  const controller=new ClientController({state,save:async()=>{},request:fetch});
  const proxy=new LlmProxy({controller,authority:root,policy:defaultPolicy(),port:0,resolve:async()=>({address:'127.0.0.1',family:4}),upstreamPort:origin.address().port,upstreamCA:trusted?root.cert:undefined});await proxy.start();
  t.after(async()=>{await proxy.stop();origin.closeAllConnections();await new Promise(r=>origin.close(r));});return {proxy,controller,origin,observed};
}
function tunnel(proxy,host,{trust=root.cert,auth=true}={}){return new Promise((resolve,reject)=>{const connect=http.request({hostname:'127.0.0.1',port:proxy.port,method:'CONNECT',path:host+':443',headers:auth?{'Proxy-Authorization':'Basic '+Buffer.from('usovia:'+proxy.key).toString('base64')}:{}});connect.on('connect',(res,socket)=>{if(res.statusCode!==200){socket.destroy();reject(new Error(String(res.statusCode)));return;}const secure=tls.connect({socket,servername:host,ca:trust,ALPNProtocols:['http/1.1']});secure.once('secureConnect',()=>resolve(secure));secure.once('error',reject);});connect.once('error',reject);connect.end();});}
async function request(proxy,host,path,body,options){const socket=await tunnel(proxy,host,options);const text=JSON.stringify(body);const result=new Promise((resolve,reject)=>{const chunks=[];socket.on('data',c=>chunks.push(c));socket.once('end',()=>{const bytes=Buffer.concat(chunks);resolve({raw:bytes.toString('utf8'),bytes,certificate:socket.getPeerCertificate()});});socket.once('error',reject);});socket.write(`POST ${path} HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nAuthorization: Bearer SYNTHETIC_UPSTREAM_KEY\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`);return result;}
test('strict CA validation is scoped to a hostname and never accepts a foreign authority',async()=>{const leaf=await issueLeaf(root,'api.openai.com'),foreign=await generateAuthority();assert.ok(verifyEndpointCertificate(leaf.cert,'api.openai.com',root.cert,['api.openai.com']));assert.equal(verifyEndpointCertificate(leaf.cert,'example.com',root.cert,['example.com']),false);assert.equal(verifyEndpointCertificate(leaf.cert,'api.openai.com',root.cert,[]),false);assert.equal(verifyEndpointCertificate(leaf.cert,'api.openai.com',foreign.cert,['api.openai.com']),false);assert.equal(verifyEndpointCertificate(root.cert,'api.openai.com',root.cert,['api.openai.com']),false);});
test('proxy sends original request, streams original response and queues only redacted human prompt',async t=>{const {proxy,controller,observed}=await setup(t);const body={messages:[{role:'system',content:'PRIVATE_SYSTEM'},{role:'user',content:'Redacta un correo a persona@example.invalid'}],model:'synthetic',stream:true};const {raw}=await request(proxy,'api.openai.com','/v1/chat/completions',body);assert.match(raw,/200 OK/);assert.ok(raw.includes('data: {"text":"ok"}\n\n'));assert.ok(raw.includes('data: [DONE]\n\n'));assert.deepEqual(JSON.parse(observed[0].text),body);assert.equal(observed[0].headers.authorization,'Bearer SYNTHETIC_UPSTREAM_KEY');assert.equal(observed[0].headers['proxy-authorization'],undefined);assert.equal(controller.state.pending.length,1);assert.ok(!JSON.stringify(controller.state.pending).includes('PRIVATE_SYSTEM'));assert.ok(!JSON.stringify(controller.state.pending).includes('persona@example.invalid'));assert.equal(controller.state.pending[0].upstreamStatus,200);assert.equal(proxy.stats.captured,1);});
test('non-LLM traffic receives the origin certificate and is never captured',async t=>{const {proxy,controller}=await setup(t);const foreignLeaf=await issueLeaf(root,'unrelated.example');const origin=https.createServer(foreignLeaf,(_req,res)=>res.end('unrelated'));await new Promise(r=>origin.listen(0,'127.0.0.1',r));t.after(()=>{origin.closeAllConnections();origin.close();});proxy.upstreamPort=origin.address().port;const socket=await tunnel(proxy,'unrelated.example');assert.ok(socket.getPeerCertificate().subject.CN==='unrelated.example');assert.equal(proxy.stats.inspected,0);assert.equal(proxy.stats.tunneled,1);assert.equal(controller.state.pending.length,0);socket.destroy();});
test('non-generation routes on LLM hosts never produce events',async t=>{const {proxy,controller}=await setup(t);await request(proxy,'api.openai.com','/v1/login',{messages:[{role:'user',content:'not a generation'}]});assert.equal(controller.state.pending.length,0);});
test('unknown upstream CA fails validation even when the client trusts Usovia',async t=>{const {proxy,controller}=await setup(t,{trusted:false});const {raw}=await request(proxy,'api.openai.com','/v1/chat/completions',{messages:[{role:'user',content:'hello'}]});assert.match(raw,/502 Bad Gateway/);assert.equal(controller.state.pending.length,0);});
test('proxy authentication, policy change and pause stop inspected connections',async t=>{const {proxy,controller}=await setup(t);await assert.rejects(tunnel(proxy,'api.openai.com',{auth:false}),/407/);const socket=await tunnel(proxy,'api.openai.com');const closed=new Promise(r=>socket.once('close',r));const policy=defaultPolicy();policy.endpoints.forEach(e=>e.enabled=false);await proxy.applyPolicy(policy);await closed;controller.state.consent.capture=false;await proxy.stop();assert.equal(proxy.server,null);assert.equal(proxy.sockets.size,0);});
test('normal proxy resolution refuses local, private and link-local addresses',()=>{for(const address of ['127.0.0.1','10.0.0.1','172.16.1.2','192.168.1.2','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicAddress(address),false,address);assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700::1111'),true);});

test('web responses with CSP headers larger than Node default are preserved',async t=>{const {proxy,controller}=await setup(t,{largeHeaders:true});const {raw}=await request(proxy,'api.openai.com','/v1/chat/completions',{messages:[{role:'user',content:'Explica certificados'}]});assert.match(raw,/200 OK/);assert.ok(raw.includes('Content-Security-Policy')||raw.includes('content-security-policy'));assert.equal(controller.state.pending.length,1);});

test('browser listener needs local opt-in, accepts LLM only and keeps SDK proxy authenticated',async t=>{
  const {proxy,controller}=await setup(t);const browser=new LlmProxy({controller,authority:root,policy:defaultPolicy(),port:0,systemBrowser:true,resolve:proxy.resolve,upstreamPort:proxy.upstreamPort,upstreamCA:root.cert});await browser.start();t.after(()=>browser.stop());
  const {raw}=await request(browser,'api.openai.com','/v1/chat/completions',{messages:[{role:'user',content:'Sintético browser'}]},{auth:false});assert.match(raw,/200 OK/);assert.equal(browser.stats.captured,1);
  await assert.rejects(tunnel(browser,'example.com',{auth:false}),/403/);
  await assert.rejects(tunnel(proxy,'api.openai.com',{auth:false}),/407/);
  controller.state.consent.capture=false;await assert.rejects(tunnel(browser,'api.openai.com',{auth:false}),/503/);
});
test('cached browser PAC never blocks a retired LLM host and its TLS is no longer inspected',async t=>{
  const {proxy,controller}=await setup(t);const browser=new LlmProxy({controller,authority:root,policy:defaultPolicy(),port:0,systemBrowser:true,resolve:proxy.resolve,upstreamPort:proxy.upstreamPort,upstreamCA:root.cert});await browser.start();t.after(()=>browser.stop());
  const next=defaultPolicy();next.revision=2;next.endpoints.filter(e=>e.id.startsWith('openai')).forEach(e=>e.enabled=false);await browser.applyPolicy(next);
  const {raw}=await request(browser,'api.openai.com','/v1/chat/completions',{messages:[{role:'user',content:'No longer observed'}]},{auth:false});
  assert.match(raw,/200 OK/);assert.equal(browser.stats.captured,0);assert.equal(browser.stats.inspected,0);assert.equal(browser.stats.tunneled,1);assert.equal(controller.state.pending.length,0);
  await assert.rejects(tunnel(browser,'example.com',{auth:false}),/403/);
});

test('TLS capture preserves compressed streaming bytes and redacts the authorized response independently',async t=>{
 const payload='data: {"choices":[{"delta":{"content":"Reply to persona@example.invalid api_key=abcdefghijklmnop123456"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
 const {proxy,controller}=await setup(t,{responsePayload:payload,compressed:true});controller.state.consent.captureResponses=true;
 const result=await request(proxy,'api.openai.com','/v1/chat/completions',{messages:[{role:'user',content:'Original api_key=abcdefghijklmnop123456'}]});
 const start=result.bytes.indexOf(Buffer.from('\r\n\r\n'))+4;assert.deepEqual(result.bytes.subarray(start),gzipSync(Buffer.from(payload)));
 for(let i=0;i<100&&!controller.state.pending.length;i++)await new Promise(r=>setTimeout(r,5));const event=controller.state.pending[0];assert.equal(event.responseStatus,'complete');assert.ok(event.redactedResponse.includes('Reply'));assert.ok(!JSON.stringify(event).includes('example.invalid'));assert.ok(!JSON.stringify(event).includes('abcdefghijklmnop123456'));assert.equal(event.turnIndex,1);
});
test('response sharing withdrawn mid-stream discards a late turn while original inference still finishes',async t=>{
 const payload='data: {"choices":[{"delta":{"content":"Late response"}}]}\n\ndata: [DONE]\n\n';const {proxy,controller}=await setup(t,{responsePayload:payload});controller.state.consent.captureResponses=true;
 const ongoing=request(proxy,'api.openai.com','/v1/chat/completions',{messages:[{role:'user',content:'Original'}]});
 while(!proxy.stats.captured)await new Promise(r=>setTimeout(r,1));await controller.setConsent({capture:true,shareText:true,captureResponses:false,reportStatus:false});assert.match((await ongoing).raw,/Late response/);assert.equal(controller.state.pending.length,0);
});
