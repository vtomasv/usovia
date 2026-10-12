// This catalog is the client-side security boundary. The Hub cannot expand TLS
// inspection to arbitrary hosts, wildcard domains, authentication or payment sites.
export const providerCatalog = [
  {id:'openai-chat',provider:'OpenAI',label:'OpenAI · Chat Completions',url:'https://api.openai.com/v1/chat/completions',adapter:'messages',channel:'tls_api'},
  {id:'openai-responses',provider:'OpenAI',label:'OpenAI · Responses',url:'https://api.openai.com/v1/responses',adapter:'responses',channel:'tls_api'},
  {id:'anthropic',provider:'Anthropic',label:'Anthropic · Messages',url:'https://api.anthropic.com/v1/messages',adapter:'messages',channel:'tls_api'},
  {id:'gemini-api',provider:'Google Gemini',label:'Gemini · API',url:'https://generativelanguage.googleapis.com/v1beta/models/',adapter:'gemini',channel:'tls_api',prefix:true},
  {id:'gemini-stable',provider:'Google Gemini',label:'Gemini · API v1',url:'https://generativelanguage.googleapis.com/v1/models/',adapter:'gemini',channel:'tls_api',prefix:true},
  {id:'gemini-cli',provider:'Google Gemini',label:'Gemini CLI · Code Assist',url:'https://cloudcode-pa.googleapis.com/v1internal:',adapter:'gemini',channel:'tls_cli',prefix:true},
  {id:'gemini-web',provider:'Google Gemini',label:'Gemini · Web',url:'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',adapter:'gemini-web',channel:'tls_web'},
  {id:'mistral',provider:'Mistral',label:'Mistral · Chat',url:'https://api.mistral.ai/v1/chat/completions',adapter:'messages',channel:'tls_api'},
  {id:'groq',provider:'Groq',label:'Groq · Chat',url:'https://api.groq.com/openai/v1/chat/completions',adapter:'messages',channel:'tls_api'},
  {id:'deepseek',provider:'DeepSeek',label:'DeepSeek · Chat',url:'https://api.deepseek.com/chat/completions',adapter:'messages',channel:'tls_api'},
  {id:'deepseek-v1',provider:'DeepSeek',label:'DeepSeek · Chat v1',url:'https://api.deepseek.com/v1/chat/completions',adapter:'messages',channel:'tls_api'},
  {id:'xai',provider:'xAI',label:'xAI · Chat',url:'https://api.x.ai/v1/chat/completions',adapter:'messages',channel:'tls_api'},
  {id:'perplexity',provider:'Perplexity',label:'Perplexity · Sonar (compatibilidad)',url:'https://api.perplexity.ai/v1/sonar',allowedPaths:['/chat/completions','/v1/sonar'],adapter:'messages',channel:'tls_api'},
  {id:'perplexity-agent',provider:'Perplexity',label:'Perplexity · Agent API',url:'https://api.perplexity.ai/v1/agent',adapter:'responses',channel:'tls_api'}
];
export const defaultPolicy=()=>({schemaVersion:1,revision:1,updatedAt:null,endpoints:providerCatalog.map(e=>({id:e.id,url:e.url,enabled:['openai-chat','openai-responses','anthropic','gemini-api','gemini-stable','gemini-cli','gemini-web'].includes(e.id)}))});
export function validatePolicy(value){
  if(!value||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.endpoints)||value.endpoints.length>providerCatalog.length)throw new Error('Política de proveedores inválida.');
  const seen=new Set();
  const endpoints=value.endpoints.map(e=>{
    const catalog=providerCatalog.find(c=>c.id===e?.id);
    if(!catalog||seen.has(e.id)||typeof e.enabled!=='boolean'||typeof e.url!=='string')throw new Error('Proveedor desconocido, duplicado o sin permiso explícito.');
    seen.add(e.id);let url;try{url=new URL(e.url);}catch{throw new Error('URL inválida.');}
    const base=new URL(catalog.url);
    if(url.protocol!=='https:'||url.origin!==base.origin||url.username||url.password||url.search||url.hash||e.url.includes('\\')||/%/i.test(url.pathname))throw new Error('Solo se admiten las URLs HTTPS de generación del catálogo LLM.');
    const validPath=catalog.prefix?url.pathname===base.pathname||generationPath(catalog,url.pathname):(catalog.allowedPaths||[base.pathname]).includes(url.pathname);
    if(!validPath)throw new Error('La ruta no corresponde a generación de este proveedor.');
    return {id:e.id,url:url.href,enabled:e.enabled};
  });
  return {schemaVersion:1,revision:value.revision,updatedAt:typeof value.updatedAt==='string'?value.updatedAt:null,endpoints};
}
function generationPath(entry,path){
  const base=new URL(entry.url).pathname;
  return entry.id==='gemini-cli'?['generateContent','streamGenerateContent'].some(x=>path===base+x):path.startsWith(base)&&/^[A-Za-z0-9._-]+:(streamGenerateContent|generateContent)$/.test(path.slice(base.length));
}
export function enabledHosts(policy){return [...new Set(validatePolicy(policy).endpoints.filter(e=>e.enabled).map(e=>new URL(e.url).hostname))];}
export function matchEndpoint(policy,hostname,path,method='POST'){
  if(method!=='POST')return null;
  for(const e of policy.endpoints){if(!e.enabled)continue;const url=new URL(e.url);if(url.hostname!==hostname)continue;const catalog=providerCatalog.find(c=>c.id===e.id);
    if(path===url.pathname&&(!catalog.prefix||generationPath(catalog,path))||catalog.prefix&&path.startsWith(url.pathname)&&generationPath(catalog,path))return {...catalog,url:e.url};
  }return null;
}
const strings=content=>typeof content==='string'?[content]:Array.isArray(content)?content.filter(p=>p&&['text','input_text'].includes(p.type)&&typeof p.text==='string').map(p=>p.text):[];
export function extractPrompt(endpoint,body,contentType='application/json'){
  try{
    let value;
    if(endpoint.adapter==='gemini-web'){
      if(!contentType.includes('application/x-www-form-urlencoded'))return null;
      const request=new URLSearchParams(body).get('f.req');if(!request)return null;
      const outer=JSON.parse(request);if(!Array.isArray(outer)||typeof outer[1]!=='string')return null;
      const inner=JSON.parse(outer[1]);
      // Bard StreamGenerate: only the prompt slot, never arbitrary recursive leaves.
      const prompt=inner?.[0]?.[0];return typeof prompt==='string'&&prompt.trim()?{prompt:prompt.slice(0,12000),...(prompt.length>12000?{promptTruncated:true}:{}),model:''}:null;
    }
    if(!contentType.includes('application/json'))return null;
    value=JSON.parse(body);if(!value||typeof value!=='object'||Array.isArray(value))return null;
    let parts=[];
    if(endpoint.adapter==='messages'){
      const messages=Array.isArray(value.messages)?value.messages:[];
      const user=messages.filter(m=>m?.role==='user').at(-1);if(user)parts=strings(user.content);
    }else if(endpoint.adapter==='responses'){
      if(typeof value.input==='string')parts=[value.input];else if(Array.isArray(value.input)){const user=value.input.filter(m=>m?.type===undefined||m?.type==='message').filter(m=>m?.role==='user').at(-1);if(user)parts=strings(user.content);}
    }else if(endpoint.adapter==='gemini'){
      const request=value.request??value;if(!request||typeof request!=='object'||Array.isArray(request))return null;
      const user=(Array.isArray(request.contents)?request.contents:[]).filter(m=>m&&(m.role==='user'||m.role===undefined)).at(-1);
      if(user)parts=(Array.isArray(user.parts)?user.parts:[]).filter(p=>typeof p?.text==='string').map(p=>p.text);
    }
    const prompt=parts.join('\n');if(!prompt.trim())return null;
    return {prompt:prompt.slice(0,12000),...(prompt.length>12000?{promptTruncated:true}:{}),model:typeof value.model==='string'?value.model.slice(0,70):''};
  }catch{return null;}
}
