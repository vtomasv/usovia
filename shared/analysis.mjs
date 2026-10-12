// CPU-only, explainable microclassification. It never calls an external model.
const categories = [
  ['programacion','Desarrollo de software',/\b(c[oó]digo|python|javascript|typescript|sql|debug|funci[oó]n|docker|api|bug|test)\b/i],
  ['datos','Análisis de datos',/\b(datos|excel|csv|tabla|estad[ií]stic|analiza|m[eé]trica|indicador)\b/i],
  ['redaccion','Redacción y comunicación',/\b(redacta|correo|resume|resumen|informe|texto|reescribe|comunicado|traduce)\b/i],
  ['clientes','Atención al cliente',/\b(cliente|ticket|reclamo|soporte|devoluci[oó]n)\b/i],
  ['aprendizaje','Aprendizaje e investigación',/\b(explica|ense[ñn]a|aprende|investiga|c[oó]mo funciona|qu[eé] es)\b/i],
  ['planificacion','Planificación',/\b(plan|agenda|organiza|estrategia|proyecto|prioriza)\b/i]
];
export const TASK_LABELS=Object.fromEntries([...categories.map(([id,label])=>[id,label]),['general','Uso general']]);
const detectors=[
  ['clave_privada',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['credencial',/\b(?:sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g],
  ['credencial',/\b(?:api[_-]?key|password|passwd|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?[^\s,"';]{6,}/gi],
  ['credencial',/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi],
  ['email',/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['rut',/\b\d{1,2}(?:\.\d{3}){2}-[\dkK]\b|\b\d{7,8}-[\dkK]\b/g],
  ['telefono',/(?<!\w)\+\d[\d ()-]{8,17}\d\b/g]
];
export function redact(text){
  let clean=String(text??'').slice(0,12000), count=0;
  const kinds=new Set();
  for(const [kind,regex] of detectors){
    clean=clean.replace(regex,()=>{count++;kinds.add(kind);return `[REDACTADO:${kind}]`;});
  }
  return {text:clean,count,kinds:[...kinds],hasSecret:kinds.has('credencial')||kinds.has('clave_privada')};
}
export function analyze(text){
  const safe=redact(text);
  // Privacy exclusions describe permitted context, not an analytics task.
  const intent=safe.text.replace(/\b(?:sin|no incluyas|evita|omite)\s+(?:usar\s+)?datos\s+(?:personales|sensibles|privados|identificables)\b/gi,'');
  const match=categories.find(([, ,regex])=>regex.test(intent));
  const task=match?.[0]??'general';
  const tips=[];
  if(safe.text.length<100)tips.push({id:'context',title:'Agrega contexto útil',detail:'Indica para quién es el resultado, cuál es el objetivo y qué información puede utilizar.',example:'Objetivo: …\nContexto permitido: …\nAudiencia: …'});
  if(!/\b(formato|tabla|json|lista|vi[ñn]eta|estructura|columnas|secciones)\b/i.test(safe.text))tips.push({id:'format',title:'Define el formato de salida',detail:'Una estructura explícita reduce las rondas de corrección.',example:'Entrega el resultado en una tabla con: propuesta, fundamento y próximo paso.'});
  if(!/\b(verifica|fuente|cita|supuesto|incertidumbre|valida|comprueba)\b/i.test(safe.text))tips.push({id:'verify',title:'Pide una comprobación',detail:'Solicita que distinga hechos, supuestos y puntos que necesitan revisión humana.',example:'Distingue hechos y supuestos. Señala qué debería verificar antes de usar el resultado.'});
  if(safe.count)tips.unshift({id:'privacy',title:'Comparte menos datos identificables',detail:`Se detectaron ${safe.count} fragmentos que serán redactados antes de compartir con tu empresa. Revisa también nombres y contexto.`,example:'Usa marcadores como [CLIENTE] y [PROYECTO] cuando el dato concreto no sea necesario.'});
  if(!tips.length)tips.push({id:'reuse',title:'Convierte este enfoque en una plantilla',detail:'Ya incluyes contexto, formato y verificación. Guarda una versión genérica para futuras tareas.',example:'Tarea: …\nContexto: …\nFormato: …\nCriterios de revisión: …'});
  return {task,label:TASK_LABELS[task],redactedText:safe.text,redactions:safe.count,sensitiveKinds:safe.kinds,hasSecret:safe.hasSecret,tips,method:'reglas_cpu_v1',quality:'orientativa'};
}
export function aggregate(events){
  const counts={};
  for(const e of events)counts[e.task]=(counts[e.task]??0)+1;
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([id,count])=>({id,label:TASK_LABELS[id]??TASK_LABELS.general,count}));
}
export function opportunities(events){
  const recurring=aggregate(events).filter(t=>t.count>=3);
  return recurring.map(t=>({id:t.id,title:{redaccion:'Crear plantillas de comunicación',programacion:'Estandarizar revisión de código',datos:'Repetir análisis con un flujo validado',clientes:'Preparar respuestas asistidas',aprendizaje:'Compartir guías de aprendizaje',planificacion:'Crear una plantilla de planificación'}[t.id]??'Documentar una tarea recurrente',task:t.label,count:t.count,description:'Este patrón aparece en los aportes voluntarios. Valida calidad, tiempo y necesidad antes de automatizar.',stage:'Hipótesis',intent:'Mejora de tareas'}));
}
