import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy,validatePolicy,enabledHosts,matchEndpoint,extractPrompt} from '../shared/providers.mjs';
import {FileStore} from '../server/store.mjs';
import {HubService} from '../server/service.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClientController,initialClient} from '../desktop/controller.mjs';
const endpoint=id=>matchEndpoint(defaultPolicy(),new URL(defaultPolicy().endpoints.find(e=>e.id===id).url).hostname,id==='gemini-api'?'/v1beta/models/gemini-2.5-flash:generateContent':new URL(defaultPolicy().endpoints.find(e=>e.id===id).url).pathname);
test('central policy cannot expand inspection to unrelated, wildcard, secret or auth URLs',()=>{
  for(const url of ['https://example.com/v1/messages','https://api.anthropic.com.evil.invalid/v1/messages','https://*.anthropic.com/v1/messages','http://api.anthropic.com/v1/messages','https://secret@api.anthropic.com/v1/messages','https://api.anthropic.com/v1/messages?key=secret','https://api.anthropic.com/login','https://api.anthropic.com/v1/%6dessages','https://api.anthropic.com:444/v1/messages']){
    const p=defaultPolicy();p.endpoints.find(e=>e.id==='anthropic').url=url;assert.throws(()=>validatePolicy(p),url);
  }
  assert.throws(()=>validatePolicy({...defaultPolicy(),endpoints:[{id:'arbitrary',url:'https://bank.example/',enabled:true}]}));
});
test('only selected generation paths and POST match, not auth, model lists or disabled LLMs',()=>{
  const p=defaultPolicy();assert.ok(matchEndpoint(p,'api.openai.com','/v1/responses'));
  for(const [host,path,method] of [['api.openai.com','/v1/models','GET'],['accounts.google.com','/login','POST'],['gemini.google.com','/app','POST'],['api.mistral.ai','/v1/chat/completions','POST'],['api.openai.com','/v1/responses/batches','POST']])assert.equal(matchEndpoint(p,host,path,method),null);
  p.endpoints.find(e=>e.id==='gemini-api').url='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';assert.ok(validatePolicy(p));assert.ok(matchEndpoint(p,'generativelanguage.googleapis.com','/v1beta/models/gemini-2.5-flash:generateContent'));assert.equal(matchEndpoint(p,'generativelanguage.googleapis.com','/v1beta/models/another:generateContent'),null);
  p.endpoints.forEach(e=>e.enabled=false);assert.deepEqual(enabledHosts(p),[]);
});
test('API adapters select latest human text and exclude system, assistant, tools and image data',()=>{
  const messages={messages:[{role:'system',content:'PRIVATE_SYSTEM'},{role:'user',content:'old'},{role:'assistant',content:'PRIVATE_ANSWER'},{role:'user',content:[{type:'text',text:'Redacta un correo'},{type:'image_url',image_url:{url:'PRIVATE_IMAGE'}},{type:'tool_result',content:'PRIVATE_TOOL'}]}],model:'synthetic'};
  for(const id of ['openai-chat','anthropic'])assert.equal(extractPrompt(endpoint(id),JSON.stringify(messages)).prompt,'Redacta un correo');
  assert.equal(extractPrompt(endpoint('openai-responses'),JSON.stringify({input:[{role:'system',content:'secret'},{role:'user',content:[{type:'input_text',text:'Resume un informe'}]}]})).prompt,'Resume un informe');
  assert.equal(extractPrompt(endpoint('gemini-api'),JSON.stringify({request:{contents:[{role:'model',parts:[{text:'secret'}]},{role:'user',parts:[{text:'Explica TLS'},{inlineData:{data:'secret'}}]}]}})).prompt,'Explica TLS');
  for(const value of ['null','[]','{"request":5}','{"messages":{}}','not-json'])assert.equal(extractPrompt(endpoint('gemini-api'),value),null);
});
test('Gemini web adapter reads only the prompt slot, with no synthetic marker requirement',()=>{
  const inner=[['Explica fotosíntesis',0,null,null,null,null,0],['secret_state'],['secret_history']];
  const body=new URLSearchParams({'f.req':JSON.stringify([null,JSON.stringify(inner)]),at:'PRIVATE_CSRF'}).toString();assert.deepEqual(extractPrompt(endpoint('gemini-web'),body,'application/x-www-form-urlencoded'),{prompt:'Explica fotosíntesis',model:''});
  assert.equal(extractPrompt(endpoint('gemini-web'),'f.req='+encodeURIComponent(JSON.stringify({token:'secret'})),'application/x-www-form-urlencoded'),null);
});
test('central updates are versioned, persistent, scoped to active installations and conflict safe',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'usovia-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));const s=new HubService(new FileStore(join(dir,'state.json')));
  const a=await s.createAccount({}),i=await s.activate({activationCode:a.activationCode});const {policy}=await s.providers();assert.equal((await s.clientPolicy(i.token)).policy.revision,1);
  policy.endpoints.find(e=>e.id==='gemini-web').enabled=false;
  await s.updateProviders(policy);assert.equal((await s.clientPolicy(i.token)).policy.revision,2);assert.equal((await s.overview()).installations[0].consent.capture,false);
  await assert.rejects(s.updateProviders(policy),e=>e.status===409);await assert.rejects(s.clientPolicy('fake'),e=>e.status===401);
  await s.updateAccount(a.account.id,{enabled:false});await assert.rejects(s.clientPolicy(i.token),e=>e.status===403);
});
test('client verifies policy, rejects rollback and remote policy cannot change consent',async()=>{
  const state=initialClient();state.token='test';state.hubUrl='https://hub.invalid';let policy=defaultPolicy();const c=new ClientController({state,save:async()=>{},request:async()=>({ok:true,json:async()=>({policy})})});
  await c.refreshPolicy();assert.equal(c.state.consent.capture,false);policy={...defaultPolicy(),revision:2};await c.refreshPolicy();policy=defaultPolicy();await assert.rejects(c.refreshPolicy(),/anterior/);assert.equal(c.state.providerPolicy.revision,2);
});

test('Perplexity current Agent and compatible Sonar URLs remain limited to generation',()=>{const p=defaultPolicy();for(const id of ['perplexity','perplexity-agent'])p.endpoints.find(e=>e.id===id).enabled=true;assert.ok(matchEndpoint(p,'api.perplexity.ai','/v1/sonar'));const e=matchEndpoint(p,'api.perplexity.ai','/v1/agent');assert.equal(extractPrompt(e,JSON.stringify({preset:'fast',input:'Explica fotosíntesis'})).prompt,'Explica fotosíntesis');p.endpoints.find(e=>e.id==='perplexity').url='https://api.perplexity.ai/chat/completions';assert.ok(validatePolicy(p));assert.equal(matchEndpoint(p,'api.perplexity.ai','/v1/search'),null);});
