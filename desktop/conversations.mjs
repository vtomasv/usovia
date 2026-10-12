import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {createUnzip,createBrotliDecompress} from 'node:zlib';
import {StringDecoder} from 'node:string_decoder';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const textParts=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(p=>['text','input_text','output_text'].includes(p?.type)).map(p=>p.text||'').join('\n'):'';
export function requestContext(endpoint,raw,type){
  try{
    if(endpoint.adapter==='gemini-web'){
      const outer=JSON.parse(new URLSearchParams(raw).get('f.req')),inner=JSON.parse(outer[1]);
      // Explicit conversation slot only. Never search cookies, auth or arbitrary leaves.
      const thread=inner?.[2]?.[0];return {thread:typeof thread==='string'&&/^c_[A-Za-z0-9_-]{4,200}$/.test(thread)?thread:null,messages:null};
    }
    if(!type.includes('application/json'))return {};
    const value=JSON.parse(raw),request=value.request??value;
    const source=endpoint.adapter==='gemini'?request.contents:endpoint.adapter==='responses'?value.input:value.messages;
    const safeHistory=Array.isArray(source)&&!value.tools&&!source.some(m=>!['user','assistant','model','system','developer'].includes(m?.role)||m.images?.length||m.tool_calls||(Array.isArray(m.content)&&m.content.some(p=>!['text','input_text','output_text'].includes(p?.type)))||(Array.isArray(m.parts)&&m.parts.some(p=>typeof p?.text!=='string'||p.thought)));
    const messages=safeHistory?source.map(m=>({role:m.role==='model'?'assistant':m.role,content:endpoint.adapter==='gemini'?(m.parts||[]).filter(p=>typeof p?.text==='string'&&!p.thought).map(p=>p.text).join('\n'):textParts(m.content)})).filter(m=>['user','assistant','system','developer'].includes(m.role)):null;
    return {messages,previousResponse:typeof value.previous_response_id==='string'?value.previous_response_id:null};
  }catch{return {};}
}
export class ConversationTracker{
  constructor(state){this.state=state;if(state.sessionIndexVersion!==2){state.sessionIndex=[];state.sessionIndexVersion=2;}state.sessionKey||=randomBytes(32).toString('base64url');state.sessionIndex||=[];this.index=new Map(state.sessionIndex.map(e=>[e.key,e]));}
  key(value){return createHmac('sha256',this.state.sessionKey).update(JSON.stringify(value)).digest('hex');}
  begin({provider,model='',channel},context={}){
    const scope=[provider,channel];let key,source='independent',reuse;
    if(UUID.test(context.explicitId||'')){key=this.key([...scope,'local',context.explicitId]);source='explicit';}
    else if(context.thread){key=this.key([...scope,'thread',context.thread]);source='provider';}
    else if(context.previousResponse){key=this.key([...scope,'response',context.previousResponse]);source='provider';}
    else if(context.messages?.length>1){key=this.key([...scope,'history',context.messages.slice(0,-1)]);source='history';}
    const entry=key&&this.index.get(key);reuse=entry&&!entry.ambiguous&&!entry.used?entry:null;
    const turn={conversationId:reuse?.id||randomUUID(),turnId:randomUUID(),turnIndex:(reuse?.turn||0)+1,sessionSource:reuse?source:source==='explicit'||context.thread?source:'independent',startedAt:new Date().toISOString(),context,scope};
    // A history continuation is consumed once: concurrent branches get distinct sessions.
    if(reuse&&(source==='history'||context.previousResponse))this.index.set(key,{...entry,used:true});
    if(source==='explicit'||context.thread)this.index.set(key,{key,id:turn.conversationId,turn:turn.turnIndex});
    this.persist();return turn;
  }
  bindIdentity(turn,response){
    for(const [kind,value] of [['thread',response.thread],['response',response.responseId]])if(value){
      const key=this.key([...turn.scope,kind,value]),old=this.index.get(key);
      // Preserve an existing anchor if an identity arrived after another request.
      if(!old||old.id===turn.conversationId){this.index.set(key,{key,id:turn.conversationId,turn:Math.max(old?.turn||0,turn.turnIndex)});if(kind==='thread')turn.sessionSource='provider';}
    }
    this.persist();
  }
  complete(turn,response){
    this.bindIdentity(turn,response);
    if(turn.context.messages?.length&&response.text&&!response.truncated&&response.status==='complete'){
      const key=this.key([...turn.scope,'history',[...turn.context.messages,{role:'assistant',content:response.text}]]);const old=this.index.get(key);this.index.set(key,old&&old.id!==turn.conversationId?{key,ambiguous:true}:{key,id:turn.conversationId,turn:turn.turnIndex});
    }
    this.persist();
  }
  persist(){while(this.index.size>300)this.index.delete(this.index.keys().next().value);this.state.sessionIndex=[...this.index.values()];}
}
function responseObjects(raw,type,adapter){
  if(type.includes('text/event-stream'))return raw.split(/\r?\n\r?\n/).flatMap(frame=>{const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');try{return [JSON.parse(data)];}catch{return [];}});
  if(type.includes('ndjson'))return raw.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  if(adapter==='gemini-web'){
    // Google's length-framed transport. Parse only JSON frames, not recursive strings.
    return raw.split('\n').flatMap(line=>{try{const rows=JSON.parse(line);return Array.isArray(rows)?rows.filter(r=>r?.[0]==='wrb.fr'&&typeof r[2]==='string').flatMap(r=>{try{return [{geminiWeb:JSON.parse(r[2])}];}catch{return [];}}):[];}catch{return [];}});
  }
  try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}catch{return [];}
}
export function parseResponse(raw,{type='application/json',adapter='messages',httpStatus=200,truncated=false,aborted=false}={}){
  let output='',snapshot='',responseId=null,thread=null,recognized=false,terminal=false,error=false,modelLimited=false;
  for(const object of responseObjects(raw,type,adapter)){
    if(!object||typeof object!=='object')continue;
    const value=object.response??object;
    if(['length','max_tokens','MAX_TOKENS','max_output_tokens'].includes(value.stop_reason||value.done_reason||value.incomplete_details?.reason)||value.choices?.some?.(c=>c.finish_reason==='length')||value.candidates?.some?.(c=>c.finishReason==='MAX_TOKENS'))modelLimited=true;
    if(value.error||value.type==='error'||value.type==='response.failed'){error=true;if(typeof value.error?.message==='string'){snapshot=value.error.message.slice(0,12000);recognized=true;}}
    if(typeof value.id==='string'&&value.id.length<=200)responseId=value.id;
    if(value.type==='response.created'&&typeof value.response?.id==='string')responseId=value.response.id;
    if(value.type==='response.completed'){terminal=true;responseId=value.response?.id||responseId;}
    if(value.type==='response.output_text.delta'&&typeof value.delta==='string'){output+=value.delta;recognized=true;}
    if(value.type==='content_block_delta'&&value.delta?.type==='text_delta'){output+=value.delta.text||'';recognized=true;}
    if(value.type==='content_block_start'&&value.content_block?.type==='text'){output+=value.content_block.text||'';recognized=true;}
    if(value.type==='message_stop')terminal=true;
    if(Array.isArray(value.choices)){const c=value.choices[0];if(typeof c?.delta?.content==='string'){output+=c.delta.content;recognized=true;}if(c?.message){snapshot=textParts(c.message.content);recognized=true;}if(c?.finish_reason)terminal=true;}
    if(Array.isArray(value.content)){snapshot=value.content.filter(p=>p?.type==='text').map(p=>p.text||'').join('\n');recognized=true;terminal=true;}
    if(Array.isArray(value.output)){snapshot=value.output.filter(p=>p?.type==='message'&&p.role==='assistant').map(p=>textParts(p.content)).join('\n');recognized=true;terminal=true;}
    if(Array.isArray(value.candidates)){const c=value.candidates[0];output+=(c?.content?.parts||[]).filter(p=>typeof p?.text==='string'&&!p.thought).map(p=>p.text).join('');recognized=true;if(c?.finishReason)terminal=true;}
    if(adapter==='ollama'){const t=value.message?.content??value.response;if(typeof t==='string'){output+=t;recognized=true;}if(value.done)terminal=true;}
    if(value.geminiWeb){const id=value.geminiWeb?.[1]?.[0];if(typeof id==='string'&&/^c_[A-Za-z0-9_-]{4,200}$/.test(id))thread=id;const t=value.geminiWeb?.[4]?.[0]?.[1]?.[0];if(typeof t==='string'){snapshot=t;recognized=true;}}
    if(output.length>12000){output=output.slice(0,12000);truncated=true;}
  }
  const text=snapshot||output;
  const status=httpStatus>=400||error?'error':aborted?'aborted':truncated||text.length>12000?'truncated':!recognized?'unsupported':type.includes('text/event-stream')&&!terminal&&!raw.includes('[DONE]')?'incomplete':'complete';
  return {text:text.slice(0,12000),responseId,thread,status,modelLimited,truncated:truncated||text.length>12000};
}
// A bounded side tap. No transformation or buffering of bytes sent to the caller.
export class ResponseCapture{
  constructor(options={}){this.options=options;this.metadataDecoder=new StringDecoder('utf8');this.metadataLine='';this.identityBound=false;this.chunks=[];this.bytes=0;this.wire=0;this.truncated=false;this.error=false;this.limit=2*1024*1024;
    const encoding=String(options.encoding||'').toLowerCase();
    if(['gzip','deflate','br'].includes(encoding)){this.decoder=encoding==='br'?createBrotliDecompress():createUnzip();this.decoder.on('data',c=>this.collect(c));this.decoder.on('error',()=>{this.error=true;});this.ended=new Promise(resolve=>{this.decoder.once('end',resolve);this.decoder.once('close',resolve);});}else if(encoding&&encoding!=='identity')this.error=true;
  }
  discard(){this.metadataLine='';this.identityBound=true;this.chunks=[];this.error=true;this.truncated=false;this.discarded=true;this.decoder?.destroy();}
  identity(chunk){
    if(this.identityBound||!this.options.onIdentity)return;
    this.metadataLine+=this.metadataDecoder.write(chunk);if(this.metadataLine.length>this.limit){this.metadataLine='';this.identityBound=true;return;}
    let end;while((end=this.metadataLine.indexOf('\n'))!==-1){const line=this.metadataLine.slice(0,end);this.metadataLine=this.metadataLine.slice(end+1);try{const result=parseResponse(line,this.options);if(result.thread||result.responseId){this.options.onIdentity(result);this.identityBound=true;this.metadataLine='';break;}}catch{}}
  }
  collect(chunk){if(this.discarded)return;if(this.truncated)return;this.bytes+=chunk.length;if(this.bytes>this.limit){this.truncated=true;this.decoder?.destroy();return;}this.identity(chunk);this.chunks.push(Buffer.from(chunk));}
  add(chunk){if(this.discarded)return;this.wire+=chunk.length;if(this.wire>this.limit){this.truncated=true;this.decoder?.destroy();return;}if(this.decoder){if(!this.decoder.destroyed)this.decoder.write(chunk);}else this.collect(chunk);}
  async finish({aborted=false}={}){if(this.decoder){if(!this.decoder.destroyed)this.decoder.end();await this.ended;}const raw=Buffer.concat(this.chunks).toString('utf8');this.chunks=[];this.metadataLine='';try{return parseResponse(raw,{...this.options,truncated:this.truncated,aborted:aborted||this.error});}catch{return {text:'',status:this.truncated?'truncated':'unsupported',truncated:this.truncated};}}
}
