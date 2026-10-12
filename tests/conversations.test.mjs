import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {ConversationTracker,ResponseCapture,parseResponse,requestContext} from '../desktop/conversations.mjs';
import {ClientController,initialClient} from '../desktop/controller.mjs';
const fields={provider:'OpenAI',model:'model',channel:'tls_api'};
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
test('explicit chats keep ordered turns; independent API calls never merge by user, provider or time',()=>{
 const tracker=new ConversationTracker({}),id=randomUUID();const a=tracker.begin(fields,{explicitId:id}),b=tracker.begin(fields,{explicitId:id}),c=tracker.begin(fields,{explicitId:randomUUID()});
 assert.equal(a.conversationId,b.conversationId);assert.equal(b.turnIndex,2);assert.notEqual(c.conversationId,a.conversationId);
 assert.notEqual(tracker.begin(fields,{}).conversationId,tracker.begin(fields,{}).conversationId);
});
test('history continuation must match every role and exact content; concurrent branches stay separate',()=>{
 const state={},tracker=new ConversationTracker(state),history=[{role:'system',content:'instructions'},user('one')];const a=tracker.begin(fields,{messages:history});tracker.complete(a,{text:'answer',status:'complete'});
 const context={messages:[...history,assistant('answer'),user('two')]},b=tracker.begin(fields,context),branch=tracker.begin(fields,context);
 assert.equal(b.conversationId,a.conversationId);assert.equal(b.turnIndex,2);assert.notEqual(branch.conversationId,b.conversationId);assert.equal(b.sessionSource,'history');
 const different=tracker.begin(fields,{messages:[{role:'system',content:'changed'},user('one'),assistant('answer'),user('two')]});assert.notEqual(different.conversationId,a.conversationId);
 assert.ok(!JSON.stringify(state).includes('instructions'));assert.ok(!JSON.stringify(state).includes('answer'));
});
test('Responses previous_response_id links once; metadata is hashed and isolated by provider/channel',()=>{
 const tracker=new ConversationTracker({});const a=tracker.begin(fields);tracker.complete(a,{responseId:'resp_private_identifier',status:'complete',text:'ok'});
 const b=tracker.begin(fields,{previousResponse:'resp_private_identifier'}),c=tracker.begin(fields,{previousResponse:'resp_private_identifier'});assert.equal(a.conversationId,b.conversationId);assert.notEqual(c.conversationId,a.conversationId);
 const thread=tracker.begin(fields,{thread:'c_private_value'}),other=tracker.begin({...fields,provider:'other'},{thread:'c_private_value'});assert.notEqual(thread.conversationId,other.conversationId);
 assert.ok(!JSON.stringify(tracker.state.sessionIndex).includes('private'));
});
test('response parsers capture visible text only, without thinking, tools, citations or auth metadata',()=>{
 assert.equal(parseResponse('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: {"choices":[{"delta":{"content":" mundo","reasoning_content":"PRIVATE_REASONING"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{type:'text/event-stream'}).text,'Hola mundo');
 assert.equal(parseResponse(JSON.stringify({content:[{type:'thinking',thinking:'PRIVATE'},{type:'text',text:'visible'}]})).text,'visible');
 assert.equal(parseResponse('data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: {"type":"response.completed","response":{"id":"resp_1"}}\n\n',{type:'text/event-stream',adapter:'responses'}).text,'Hello');
 assert.equal(parseResponse('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"visible"}}\n\ndata: {"type":"message_stop"}\n\n',{type:'text/event-stream'}).status,'complete');
 assert.equal(parseResponse(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'PRIVATE'},{text:'visible'}]},finishReason:'STOP'}]}),{adapter:'gemini'}).text,'visible');
 assert.equal(parseResponse('{"message":{"content":"one"},"done":false}\n{"message":{"content":" two"},"done":true}\n',{type:'application/x-ndjson',adapter:'ollama'}).text,'one two');
});
test('Gemini web uses known candidate text slot and prompt thread slot, never recursive string collection',()=>{
 const value=[null,['c_private'],null,null,[['rc_private',['visible answer'],null,'PRIVATE_METADATA']]];const frame=JSON.stringify([['wrb.fr',null,JSON.stringify(value)]]);
 const response=parseResponse(")]}'\n\n"+frame+'\n',{adapter:'gemini-web'});assert.equal(response.text,'visible answer');assert.ok(!response.text.includes('PRIVATE'));
 const raw=new URLSearchParams({'f.req':JSON.stringify([null,JSON.stringify([['hello'],null,['c_thread_value','r_other']])])}).toString();assert.equal(requestContext({adapter:'gemini-web'},raw,'application/x-www-form-urlencoded').thread,'c_thread_value');
});
test('compressed Unicode side capture is bounded and does not change source bytes',async()=>{
 for(const [encoding,compress] of [['gzip',gzipSync],['br',brotliCompressSync]]){const raw=Buffer.from(JSON.stringify({choices:[{message:{content:'日本語 😀'}}]}));const encoded=compress(raw),copy=Buffer.from(encoded),tap=new ResponseCapture({encoding,type:'application/json'});for(let i=0;i<encoded.length;i+=3)tap.add(encoded.subarray(i,i+3));const result=await tap.finish();assert.equal(result.text,'日本語 😀');assert.deepEqual(encoded,copy);}
 const tap=new ResponseCapture({});tap.add(Buffer.alloc(2*1024*1024+1,65));const result=await tap.finish();assert.equal(result.truncated,true);assert.equal(tap.chunks.length,0);
});
test('capture records truncation, interruption, unsupported formats and provider errors',()=>{
 assert.equal(parseResponse(JSON.stringify({choices:[{message:{content:'x'.repeat(13000)}}]})).status,'truncated');
 assert.equal(parseResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{type:'text/event-stream'}).status,'incomplete');
 assert.equal(parseResponse('{"unknown":"PRIVATE"}').status,'unsupported');
 assert.equal(parseResponse('{"error":{"message":"bad key"}}',{httpStatus:401}).status,'error');
 assert.equal(parseResponse('{"choices":[{"message":{"content":"partial"}}]}',{aborted:true}).status,'aborted');
});
test('tool and image history cannot masquerade as a verified text continuation',()=>{
 const ctx=requestContext({adapter:'messages'},JSON.stringify({messages:[user('one'),{role:'tool',content:'tool result'},user('two')]}),'application/json');assert.equal(ctx.messages,null);
});
test('old prompt-only permission never shares responses; new opt-in redacts both sides; withdrawal cancels late turns',async()=>{
 const state=initialClient();state.token='synthetic';state.consent={capture:true,shareText:true,reportStatus:false};const client=new ClientController({state,save:async()=>{},request:async()=>({ok:true,json:async()=>({})})});
 const a=client.beginTurn({...fields,prompt:'hello'});await client.finishTurn(a,{text:'PRIVATE_RESPONSE',status:'complete'},200);assert.equal(state.pending[0].redactedResponse,undefined);assert.equal(state.pending[0].responseStatus,'not_authorized');
 await client.setConsent({capture:true,shareText:true,captureResponses:true,reportStatus:false});const b=client.beginTurn({...fields,prompt:'persona@example.invalid'});await client.finishTurn(b,{text:'other@example.invalid',status:'complete'},200);assert.ok(!state.pending[0].redactedText.includes('@'));assert.ok(!state.pending[0].redactedResponse.includes('@'));
 const late=client.beginTurn({...fields,prompt:'late'});await client.setConsent({capture:false,shareText:false,captureResponses:false,reportStatus:false});await client.finishTurn(late,{text:'late response',status:'complete'},200);assert.equal(state.pending.length,0);assert.equal(client.publicState().sessionKey,undefined);assert.equal(client.publicState().sessionIndex,undefined);
});

test('withdrawal immediately discards response buffers and classifier capture stays separate from model limits',async()=>{
 const state=initialClient();state.token='synthetic';state.consent={capture:true,shareText:true,captureResponses:true,reportStatus:false};const client=new ClientController({state,save:async()=>{},request:async()=>({ok:true,json:async()=>({})})}),tap=new ResponseCapture({adapter:'ollama',type:'application/x-ndjson'});client.observeResponse(tap);tap.add(Buffer.from('{"message":{"content":"PRIVATE_PARTIAL"},"done":false}\n'));
 await client.setConsent({capture:true,shareText:true,captureResponses:false,reportStatus:false});assert.equal(tap.chunks.length,0);assert.equal(client.observers.size,0);tap.add(Buffer.from('LATE_PRIVATE'));assert.equal((await tap.finish()).text,'');
 const result=parseResponse('{"message":{"content":"visible partial"},"done":true,"done_reason":"length"}\n',{adapter:'ollama',type:'application/x-ndjson'});assert.equal(result.modelLimited,true);assert.equal(result.truncated,false);assert.equal(result.status,'complete');
});

test('explicit sessions survive model changes and duplicate identical histories never merge two chats',()=>{
 const tracker=new ConversationTracker({}),id=randomUUID(),a=tracker.begin(fields,{explicitId:id}),b=tracker.begin({...fields,model:'different'},{explicitId:id});assert.equal(a.conversationId,b.conversationId);assert.equal(b.turnIndex,2);
 const history=[user('same')],one=tracker.begin(fields,{messages:history}),two=tracker.begin(fields,{messages:history});for(const t of [one,two])tracker.complete(t,{text:'same answer',status:'complete'});const next=tracker.begin(fields,{messages:[...history,assistant('same answer'),user('next')]});assert.notEqual(next.conversationId,one.conversationId);assert.notEqual(next.conversationId,two.conversationId);assert.equal(next.sessionSource,'independent');
});

test('first Gemini web turn binds its provider conversation before stream completion, allowing an ordered follow-up',async()=>{
 const tracker=new ConversationTracker({}),web={provider:'Google Gemini',channel:'tls_web'},first=tracker.begin(web,{}),value=[null,['c_fresh_thread'],null,null,[['rc_choice',['partial answer']]]],tap=new ResponseCapture({adapter:'gemini-web',onIdentity:identity=>tracker.bindIdentity(first,identity)});
 tap.add(Buffer.from(JSON.stringify([['wrb.fr',null,JSON.stringify(value)]])+'\n'));const next=tracker.begin(web,{thread:'c_fresh_thread'});assert.equal(first.conversationId,next.conversationId);assert.equal(next.turnIndex,2);assert.equal(first.sessionSource,'provider');assert.equal((await tap.finish()).thread,'c_fresh_thread');
 const malformed=new ResponseCapture({adapter:'gemini'});malformed.add(Buffer.from('{"candidates":[{"content":{"parts":"unexpected"}}]}'));assert.equal((await malformed.finish()).status,'unsupported');
});
