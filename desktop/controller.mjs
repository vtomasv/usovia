import {randomUUID} from 'node:crypto';
import {analyze} from '../shared/analysis.mjs';
import {validatePolicy} from '../shared/providers.mjs';
import {ConversationTracker} from './conversations.mjs';
export function normalizeHub(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Usa la URL principal del Hub, sin credenciales ni rutas.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('La conexión corporativa requiere HTTPS.');
  return url.origin;
}
export const initialClient=()=>({hubUrl:'',account:null,installationId:null,token:null,consent:{capture:false,shareText:false,captureResponses:false,reportStatus:false},consentVersion:0,consentNeedsSync:false,pending:[],lastSync:null,error:null,recommendations:[],model:'',monitoringMode:'observe',providerPolicy:null,policySyncedAt:null,policyError:null,localReviews:[],localProxyKey:null});
export class ClientController{
  constructor({state,save,request,version='1.0.0'}){this.version=version;this.state=state||initialClient();this.save=save;this.request=request;this.tail=Promise.resolve();this.generation=0;this.inFlight=new Set();this.observers=new Set();this.state.consent.captureResponses=!!this.state.consent.captureResponses;delete this.state.blockSecrets;this.sessions=new ConversationTracker(this.state);}
  publicState(){const {token,pending,localProxyKey,sessionKey,sessionIndex,sessionIndexVersion,...rest}=this.state;return {...rest,pendingCount:pending.length};}
  async call(path,body,{signal}={}){
    const response=await this.request(`${this.state.hubUrl}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(this.state.token?{Authorization:`Bearer ${this.state.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
    const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'No se pudo conectar al Hub.'),{status:response.status});return result;
  }
  async activate(hubUrl,code,platform){
    if(this.state.token)throw new Error('Desconecta la cuenta actual antes de activar otra.');
    this.state.hubUrl=normalizeHub(hubUrl);
    const response=await this.call('activate',{activationCode:code,platform,version:this.version});
    Object.assign(this.state,{account:response.account,installationId:response.installationId,token:response.token});await this.save(this.state);return this.publicState();
  }
  async refreshPolicy(){
    if(!this.state.token)return null;
    const token=this.state.token,abort=new AbortController();this.inFlight.add(abort);
    try{const response=await this.call('client-policy',undefined,{signal:abort.signal});if(this.state.token!==token||abort.signal.aborted)throw new Error('Lectura de política cancelada.');const policy=validatePolicy(response.policy);
      if(this.state.providerPolicy&&policy.revision<this.state.providerPolicy.revision)throw new Error('El servidor devolvió una política anterior.');
      this.state.providerPolicy=policy;this.state.policySyncedAt=new Date().toISOString();this.state.policyError=null;await this.save(this.state);return policy;
    }catch(e){this.state.policyError=e.message;await this.save(this.state);throw e;}finally{this.inFlight.delete(abort);}
  }
  async setConsent(scopes){
    if(!this.state.token)throw new Error('Activa tu cuenta primero.');
    if(scopes.shareText&&!scopes.capture)throw new Error('Activa captura para compartir texto.');
    if(scopes.captureResponses&&(!scopes.capture||!scopes.shareText))throw new Error('Autoriza captura y envío de solicitudes antes de compartir respuestas.');
    // Local stop always precedes network I/O; discard old epochs on any permission change.
    this.generation++;for(const observer of this.observers)observer.discard();this.observers.clear();for(const controller of this.inFlight)controller.abort();this.inFlight.clear();
    this.state.consent={capture:!!scopes.capture,shareText:!!scopes.shareText,captureResponses:!!scopes.captureResponses,reportStatus:!!scopes.reportStatus};
    this.state.consentVersion++;this.state.consentNeedsSync=true;this.state.pending=[];await this.save(this.state);
    try{await this.synchronizeConsent();this.state.error=null;this.state.lastSync=new Date().toISOString();}
    catch(e){this.state.error='El cambio ya se aplicó localmente. No se pudo confirmar en el Hub: '+e.message;}
    await this.save(this.state);return this.publicState();
  }
  async synchronizeConsent(signal){
    if(!this.state.consentNeedsSync)return;
    const version=this.state.consentVersion;
    await this.call('consent',{version,scopes:this.state.consent},{signal});
    if(version===this.state.consentVersion){this.state.consentNeedsSync=false;await this.save(this.state);}
  }
  observeResponse(tap){this.observers.add(tap);return ()=>this.observers.delete(tap);}
  beginTurn(fields,context={}){return {...fields,...this.sessions.begin(fields,context),generation:this.generation,consentVersion:this.state.consentVersion};}
  async finishTurn(turn,response={status:'not_authorized',text:''},upstreamStatus=null){
    if(turn.generation!==this.generation||turn.consentVersion!==this.state.consentVersion||!this.state.consent.capture)return;
    if(this.state.consent.captureResponses)this.sessions.complete(turn,response);
    const {context,scope,generation,consentVersion,...fields}=turn;
    return this.capture({...fields,upstreamStatus,response,finishedAt:new Date().toISOString()});
  }
  async capture({prompt,provider='ollama',model='',channel='chat_usovia',upstreamStatus=null,conversationId,turnId,turnIndex,sessionSource,startedAt,finishedAt,response,promptTruncated=false}){
    const epoch=this.generation;const result=analyze(prompt);
    if(this.state.consent.capture){this.state.localReviews=[{at:new Date().toISOString(),provider,channel,upstreamStatus,label:result.label,tips:result.tips},...(this.state.localReviews||[])].slice(0,15);await this.save(this.state);}
    if(epoch===this.generation&&this.state.consent.capture&&this.state.consent.shareText&&this.state.token){
      if(this.state.pending.length>=100){this.state.error='La cola contiene 100 aportes sin sincronizar. Esta consulta se revisó localmente y no se añadió a la cola.';await this.save(this.state);return {...result,queued:false,notice:this.state.error};}
      const event={id:turnId||randomUUID(),observedAt:startedAt||new Date().toISOString(),redactedText:result.redactedText,redactions:result.redactions,provider,model,channel,upstreamStatus,consentVersion:this.state.consentVersion,conversationId:conversationId||randomUUID(),turnIndex:turnIndex||1,sessionSource:sessionSource||'independent',finishedAt:finishedAt||new Date().toISOString(),promptTruncated:!!promptTruncated,responseStatus:this.state.consent.captureResponses?(response?.status||'unsupported'):'not_authorized',responseTruncated:!!response?.truncated,modelLimited:!!response?.modelLimited};
      if(this.state.consent.captureResponses&&typeof response?.text==='string'){const redacted=analyze(response.text);event.redactedResponse=redacted.redactedText;event.responseRedactions=redacted.redactions;}
      // Keep the existing 64 KiB API envelope, including UTF-8 and JSON escaping.
      while(Buffer.byteLength(JSON.stringify({consentVersion:this.state.consentVersion,events:[event]}))>61440&&(event.redactedResponse?.length||event.redactedText.length)){
        if(event.redactedResponse?.length){event.redactedResponse=event.redactedResponse.slice(0,-256);event.responseTruncated=true;event.responseStatus='truncated';}else{event.redactedText=event.redactedText.slice(0,-256);event.promptTruncated=true;}
      }
      if(Buffer.byteLength(JSON.stringify({consentVersion:this.state.consentVersion,events:[event]}))>61440){this.state.error='El texto revisado supera el límite de envío después de codificarlo. No se añadió a la cola.';await this.save(this.state);return {...result,queued:false,notice:this.state.error};}
      this.state.pending.push(event);
      await this.save(this.state);
    }
    return result;
  }
  async flush(){
    if(!this.state.token||!this.state.consent.capture||!this.state.consent.shareText||!this.state.pending.length)return;
    const epoch=this.generation,version=this.state.consentVersion;
    const controller=new AbortController();this.inFlight.add(controller);
    const batch=[];
    for(const event of this.state.pending.filter(e=>e.consentVersion===version)){if(batch.length===20||Buffer.byteLength(JSON.stringify({consentVersion:version,events:[...batch,event]}))>61440)break;batch.push(event);}
    if(!batch.length){this.inFlight.delete(controller);this.state.error='Un aporte antiguo excede el límite de envío. Pausa captura para descartar la cola.';await this.save(this.state);return;}
    try{
      // Sync consent first to handle activation and offline edits safely.
      await this.synchronizeConsent(controller.signal);
      if(epoch!==this.generation)return;
      const response=await this.call('events',{consentVersion:version,events:batch},{signal:controller.signal});
      if(epoch!==this.generation)return;
      const accepted=new Set(response.accepted);this.state.pending=this.state.pending.filter(e=>!accepted.has(e.id));
      this.state.lastSync=new Date().toISOString();this.state.error=null;
    }catch(e){if(e.name!=='AbortError')this.state.error=e.message;}
    finally{this.inFlight.delete(controller);await this.save(this.state);}
  }
  async heartbeat(details){
    if(!this.state.token||!this.state.consent.reportStatus)return;
    const controller=new AbortController();this.inFlight.add(controller);
    try{
      await this.synchronizeConsent(controller.signal);
      if(!this.state.consent.reportStatus)return;
      await this.call('heartbeat',{...details,pending:this.state.pending.length,consentVersion:this.state.consentVersion},{signal:controller.signal});
    }catch(e){if(e.name!=='AbortError')this.state.error=e.message;}
    finally{this.inFlight.delete(controller);}
  }
  async getRecommendations(){
    if(!this.state.token)return {events:[],tasks:[],opportunities:[]};
    return this.call('recommendations'); // Explicit user-initiated read, not an automatic poll.
  }
  async disconnect({erase=false}={}){
    await this.setConsent({capture:false,shareText:false,captureResponses:false,reportStatus:false});
    if(erase)await this.call('erase',{});
    const hubUrl=this.state.hubUrl;this.state=initialClient();this.sessions=new ConversationTracker(this.state);this.state.hubUrl=hubUrl;await this.save(this.state);return this.publicState();
  }
}
