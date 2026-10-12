import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {LocalGateway} from '../desktop/gateway.mjs';
import {ClientController,initialClient} from '../desktop/controller.mjs';

async function fixture(t){
  const calls=[];
  const upstream=createServer(async(req,res)=>{
    const rawChunks=[];for await(const chunk of req)rawChunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(rawChunks).toString('utf8'));if(body.messages&&!Array.isArray(body.messages)){res.writeHead(400);res.end('{"error":"invalid messages"}');return;}calls.push(body);
    res.setHeader('Content-Type','application/x-ndjson');
    res.write('{"message":{"content":"Hola"},"done":false}\n');
    res.end('{"done":true}\n');
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const state=initialClient();state.token='synthetic';state.consent={capture:true,shareText:true,reportStatus:false};state.consentVersion=1;
  const controller=new ClientController({state,save:async()=>{},request:fetch});
  const gateway=new LocalGateway({controller,runtimeUrl:`http://127.0.0.1:${upstream.address().port}`,port:0});await gateway.start();
  t.after(async()=>{await gateway.stop();await new Promise(r=>upstream.close(r));});
  const url=`http://127.0.0.1:${gateway.server.address().port}/api/chat`;
  const request=(body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${gateway.key}`,...headers},body:JSON.stringify(body)});
  return {gateway,controller,calls,request};
}
test('gateway preserves streaming bytes and queues only redacted user text',async t=>{
  const f=await fixture(t);const prompt='Redacta un correo para persona@example.invalid';
  const response=await f.request({model:'synthetic',messages:[{role:'user',content:prompt}],stream:true});
  assert.equal(response.status,200);
  assert.equal(await response.text(),'{"message":{"content":"Hola"},"done":false}\n{"done":true}\n');
  assert.equal(f.calls[0].messages[0].content,prompt);
  assert.equal(f.controller.state.pending.length,1);
  assert.ok(!f.controller.state.pending[0].redactedText.includes('example.invalid'));
});
test('gateway observes credentials without blocking, but authenticates and rejects browser origins',async t=>{
  const f=await fixture(t);
  const secret='api_key=abcdefghijklmnop123456';const r=await f.request({prompt:secret});assert.equal(r.status,200);await r.text();assert.equal(f.calls[0].prompt,secret);
  assert.equal((await f.request({prompt:'hola'},{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await f.request({prompt:'hola'},{Origin:'https://example.invalid'})).status,403);
  assert.equal(f.calls.length,1);assert.equal(f.controller.state.pending.length,1);assert.ok(!f.controller.state.pending[0].redactedText.includes('abcdefghijklmnop123456'));
});
test('runtime validates original JSON shapes; a paused governed listener accepts no new calls',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request({messages:'invalid'})).status,400);
  f.controller.state.consent.capture=false;
  assert.equal((await f.request({prompt:'hola'})).status,503);assert.equal(f.calls.length,0);
});
test('stopping gateway cancels an in-flight generation and closes listener',async t=>{
  const upstream=createServer(async(req,res)=>{req.resume();res.writeHead(200);res.write('started');});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const controller={generation:0,state:{consent:{capture:true},blockSecrets:true},capture:async()=>{}};
  const gateway=new LocalGateway({controller,runtimeUrl:`http://127.0.0.1:${upstream.address().port}`,port:0});await gateway.start();
  t.after(()=>{upstream.closeAllConnections();upstream.close();});
  const r=await fetch(`http://127.0.0.1:${gateway.server.address().port}/api/chat`,{method:'POST',headers:{Authorization:`Bearer ${gateway.key}`},body:JSON.stringify({prompt:'hola'})});
  const reader=r.body.getReader();await reader.read();
  await gateway.stop();assert.equal(gateway.server,null);assert.equal(gateway.active.size,0);
  await assert.rejects(async()=>{while(!(await reader.read()).done){};});
});

test('gateway preserves Unicode when a character is split across network chunks',async t=>{const f=await fixture(t);const body=Buffer.from(JSON.stringify({model:'synthetic',prompt:'Explica 日本語'}));const split=body.indexOf(Buffer.from('日'))+1;
  const response=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:f.gateway.server.address().port,path:'/api/chat',method:'POST',headers:{Authorization:`Bearer ${f.gateway.key}`}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.write(body.subarray(0,split));setTimeout(()=>req.end(body.subarray(split)),10);});
  assert.equal(response,200);assert.equal(f.calls[0].prompt,'Explica 日本語');assert.equal(f.controller.state.pending[0].redactedText,'Explica 日本語');
});

test('gateway captures response with explicit opt-in, latest user turn and a stable conversation sequence',async t=>{
 const f=await fixture(t);f.controller.state.consent.captureResponses=true;const id='abababab-abab-abab-abab-abababababab';const headers={'X-Usovia-Conversation':id,'X-Usovia-Channel':'chat_usovia'};
 const first=await f.request({model:'synthetic',messages:[{role:'user',content:'First request'}],stream:true},headers);await first.text();
 const second=await f.request({model:'synthetic',messages:[{role:'user',content:'First request'},{role:'assistant',content:'Hola'},{role:'user',content:'Second request'}],stream:true},headers);await second.text();
 const [a,b]=f.controller.state.pending;assert.equal(a.redactedResponse,'Hola');assert.equal(b.redactedText,'Second request');assert.equal(a.conversationId,b.conversationId);assert.equal(b.turnIndex,2);assert.equal(a.responseStatus,'complete');assert.equal(a.channel,'chat_usovia');
});
test('gateway forwards multimodal/tools unchanged and survives failed telemetry persistence',async t=>{
 const f=await fixture(t),body={model:'synthetic',messages:[{role:'user',content:'Original api_key=abcdefghijklmnop123456',images:['synthetic_image']}],tools:[{type:'function',function:{name:'synthetic_tool'}}]};f.controller.save=async()=>{throw new Error('synthetic disk failure');};
 const response=await f.request(body);assert.equal(response.status,200);assert.match(await response.text(),/Hola/);assert.deepEqual(f.calls[0],body);
});

test('large multimodal requests bypass bounded inspection and still reach the model unchanged',async t=>{
 const f=await fixture(t),body={model:'synthetic',messages:[{role:'user',content:'Describe image',images:['x'.repeat(2*1024*1024)]}]};const response=await f.request(body);assert.equal(response.status,200);await response.text();assert.deepEqual(f.calls[0],body);assert.equal(f.controller.state.pending.length,0);
});
