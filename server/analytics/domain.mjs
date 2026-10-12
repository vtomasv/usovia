import { createHash } from 'node:crypto';
import { redact } from '../../shared/analysis.mjs';
export const RETENTION = { days: 7, maxTurns: 500 };
export const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
export const MODEL_KEY = MODEL_ID + '@' + MODEL_REVISION + ':q8:tokens128-v2';
export const OUTCOME_LABELS = {
  validated: 'Solución validada',
  positive_signal: 'Señal de aceptación',
  needs_revision: 'Requiere revisión',
  technical_issue: 'Incidencia técnica',
  unknown: 'Sin evidencia suficiente',
};
export const CATEGORIES = [
  {
    id: 'software',
    label: 'Desarrollo de software',
    terms: [
      'codigo',
      'programacion',
      'python',
      'javascript',
      'typescript',
      'sql',
      'debug',
      'docker',
      'api',
      'bug',
      'software',
      'script',
      'code',
      'programming',
      'function',
      'testing',
    ],
  },
  {
    id: 'data',
    label: 'Análisis de datos',
    terms: [
      'datos',
      'excel',
      'csv',
      'estadistica',
      'indicadores',
      'metricas',
      'dashboard',
      'dataset',
      'data',
      'analytics',
      'spreadsheet',
    ],
  },
  {
    id: 'communication',
    label: 'Comunicación y documentos',
    terms: [
      'redacta',
      'correo',
      'resumen',
      'informe',
      'comunicado',
      'traduce',
      'redaccion',
      'documento',
      'email',
      'summarize',
      'report',
      'translation',
    ],
  },
  {
    id: 'customer',
    label: 'Atención al cliente',
    terms: [
      'cliente',
      'reclamo',
      'ticket',
      'devolucion',
      'soporte',
      'customer',
      'complaint',
      'refund',
      'support',
    ],
  },
  {
    id: 'planning',
    label: 'Planificación y proyectos',
    terms: [
      'planificacion',
      'plan',
      'agenda',
      'estrategia',
      'proyecto',
      'prioriza',
      'roadmap',
      'planning',
      'project',
    ],
  },
  {
    id: 'research',
    label: 'Investigación y aprendizaje',
    terms: [
      'explica',
      'investiga',
      'aprendizaje',
      'ensenar',
      'comparar',
      'research',
      'learn',
      'explain',
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing y ventas',
    terms: [
      'campana',
      'marketing',
      'venta',
      'propuesta comercial',
      'publicidad',
      'conversion',
      'sales',
      'campaign',
    ],
  },
  {
    id: 'finance',
    label: 'Finanzas y operaciones',
    terms: [
      'presupuesto',
      'factura',
      'conciliacion',
      'contabilidad',
      'costo',
      'inventario',
      'logistica',
      'budget',
      'invoice',
      'inventory',
    ],
  },
  {
    id: 'people',
    label: 'Gestión de personas',
    terms: [
      'onboarding',
      'capacitacion',
      'recursos humanos',
      'seleccion',
      'entrevista',
      'training',
      'human resources',
    ],
  },
  {
    id: 'legal',
    label: 'Contratos y cumplimiento',
    terms: ['contrato', 'cumplimiento', 'normativa', 'licitacion', 'contract', 'compliance'],
  },
  { id: 'general', label: 'Otros usos', terms: [] },
];
const CONCEPTS = [
  [
    'refund',
    'Devoluciones y reclamos',
    ['devolucion', 'reembolso', 'reclamo', 'refund', 'complaint'],
  ],
  ['email', 'Correos y comunicación', ['correo', 'email', 'comunicado', 'mensaje']],
  [
    'summary',
    'Síntesis de documentos',
    ['resume', 'resumir', 'resumen', 'sintesis', 'summarize', 'summary'],
  ],
  ['sales', 'Propuestas y ventas', ['propuesta comercial', 'venta', 'sales', 'comercial']],
  [
    'data',
    'Análisis y reportes',
    ['datos', 'dataset', 'analisis', 'estadistica', 'data', 'analytics'],
  ],
  ['code', 'Código y depuración', ['codigo', 'python', 'debug', 'bug', 'code', 'programacion']],
  [
    'project',
    'Organización de proyectos',
    ['proyecto', 'roadmap', 'planificacion', 'agenda', 'project'],
  ],
  ['budget', 'Presupuestos y costos', ['presupuesto', 'costo', 'budget', 'cost']],
  [
    'learning',
    'Guías y capacitación',
    ['capacitacion', 'explica', 'ensenar', 'training', 'explain'],
  ],
  ['contract', 'Contratos y cumplimiento', ['contrato', 'cumplimiento', 'contract', 'compliance']],
  ['inventory', 'Inventario y logística', ['inventario', 'logistica', 'inventory']],
];
export const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export function validateFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Filtros inválidos.');
  const result = {};
  for (const key of [
    'account',
    'department',
    'office',
    'tag',
    'category',
    'outcome',
    'query',
    'from',
    'to',
  ]) {
    const v = input[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > 200) fail(400, 'Filtro inválido: ' + key);
    result[key] = v.trim();
  }
  for (const key of ['from', 'to'])
    if (
      result[key] &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) ||
        !Number.isFinite(Date.parse(result[key])) ||
        new Date(result[key]).toISOString().slice(0, 10) !== result[key])
    )
      fail(400, 'Fecha inválida.');
  if (result.from && result.to && result.from > result.to)
    fail(400, 'El inicio debe ser anterior al final.');
  if (result.category && !CATEGORIES.some((c) => c.id === result.category))
    fail(400, 'Categoría inválida.');
  if (result.outcome && !OUTCOME_LABELS[result.outcome]) fail(400, 'Resultado inválido.');
  return result;
}
function matchesTerm(text, term) {
  return new RegExp('(?:^|[^a-z0-9])' + term + '(?:[a-z]{0,3})(?=$|[^a-z0-9])').test(text);
}
export function classifyWork(text) {
  const clean = normalize(text)
    .replace(/\[redactado:[^\]]+\]/g, '')
    .replace(
      /\b(?:sin|evita|omite|no incluyas)\s+datos\s+(?:personales|sensibles|privados|identificables)\b/g,
      '',
    );
  const scores = CATEGORIES.filter((c) => c.id !== 'general')
    .map((c) => ({ ...c, score: c.terms.filter((term) => matchesTerm(clean, term)).length }))
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        [
          'customer',
          'software',
          'finance',
          'legal',
          'people',
          'marketing',
          'data',
          'planning',
          'research',
          'communication',
        ].indexOf(a.id) -
          [
            'customer',
            'software',
            'finance',
            'legal',
            'people',
            'marketing',
            'data',
            'planning',
            'research',
            'communication',
          ].indexOf(b.id),
    );
  return {
    primary: scores[0]?.id || 'general',
    labels: scores.length ? scores.map((c) => c.id) : ['general'],
    concepts: CONCEPTS.filter(([, , terms]) => terms.some((t) => matchesTerm(clean, t))).map(
      ([id, label]) => ({ id, label }),
    ),
  };
}
export function feedbackSignal(text) {
  const t = normalize(text)
      .trim()
      .replace(/[.!¡¿?]+$/g, ''),
    statement = t.replace(/^gracias[\s,!]*(?:(?:pero|sin embargo)\s+)?/, '');
  if (
    /^(?:no funciona|no sirve|sigue mal|incorrecto|no resuelve|no es lo que|todavia falla|no funciono|does not work|doesn't work)(?:$|[,.!\s])/.test(
      statement,
    )
  )
    return 'negative';
  if (
    /^(?:perfecto|excelente|listo|funciona|funciono|ya funciona|esto funciona|esto resuelve|me sirve|quedo bien|es lo que necesitaba|works now|this solves)(?:$|[,.!\s])/.test(
      statement,
    ) &&
    !/\b(?:pero|sin embargo|aunque|but|todavia|deberia|podria)\b/.test(t)
  )
    return 'positive';
  if (/^(?:corrige|corregir|revisa|ajusta|cambia|modifica|intenta de nuevo|fix|revise)\b/.test(t))
    return 'revision';
  return null;
}
const acceptance = feedbackSignal;
export function evaluateOutcome(session, review) {
  const fresh = review && review.sourceHash === session.snapshotHash;
  if (fresh) {
    const status =
      review.decision === 'validated'
        ? 'validated'
        : review.decision === 'rejected'
          ? 'needs_revision'
          : 'unknown';
    return {
      status,
      label: OUTCOME_LABELS[status],
      source: 'human_review',
      evidence: review.note || 'Revisión administrativa de esta versión de la conversación.',
      eventId: review.eventId,
      reviewedAt: review.reviewedAt,
      reviewStale: false,
    };
  }
  const last = session.turns.at(-1),
    signal = acceptance(last.redactedText);
  let status = 'unknown',
    evidence = 'No hay aceptación explícita ni revisión humana de esta versión.',
    source = 'insufficient_evidence';
  if (last.responseStatus === 'error' || last.upstreamStatus >= 400) {
    status = 'technical_issue';
    source = 'provider_status';
    evidence = 'El último turno registra un error del proveedor; no se infiere su utilidad.';
  } else if (signal === 'negative' || signal === 'revision') {
    status = 'needs_revision';
    source = 'user_statement';
    evidence = redact(last.redactedText).text.slice(0, 220);
  } else if (
    signal === 'positive' &&
    !session.hasGaps &&
    session.turns.slice(0, -1).some((t) => t.redactedResponse && t.responseStatus === 'complete')
  ) {
    status = 'positive_signal';
    source = 'user_statement';
    evidence = redact(last.redactedText).text.slice(0, 220);
  }
  return {
    status,
    label: OUTCOME_LABELS[status],
    source,
    evidence,
    eventId: source === 'user_statement' || source === 'provider_status' ? last.id : null,
    reviewStale: !!review && !fresh,
  };
}
export function retainedState(state, at = Date.now()) {
  return {
    ...state,
    events: (state.events || [])
      .filter((e) => Date.parse(e.receivedAt) > at - RETENTION.days * 86400000)
      .slice(-RETENTION.maxTurns),
  };
}
export function buildSessions(state) {
  const accounts = new Map(state.accounts.map((a) => [a.id, a])),
    map = new Map();
  for (const event of state.events) {
    if (!accounts.has(event.accountId)) continue;
    const id = event.conversationId || event.id,
      key = event.installationId + ':' + id;
    if (!map.has(key))
      map.set(key, {
        key,
        id,
        accountId: event.accountId,
        installationId: event.installationId,
        turns: [],
      });
    map.get(key).turns.push(event);
  }
  return [...map.values()]
    .map((s) => {
      s.turns.sort(
        (a, b) =>
          (a.turnIndex || 1) - (b.turnIndex || 1) ||
          Date.parse(a.observedAt) - Date.parse(b.observedAt),
      );
      const indexes = s.turns.map((t) => t.turnIndex || 1),
        prompts = s.turns.map((t) => redact(t.redactedText).text),
        semanticPrompts = prompts.filter(
          (t) =>
            !['positive', 'negative'].includes(feedbackSignal(t)) &&
            (feedbackSignal(t) !== 'revision' || t.length > 80),
        ),
        account = accounts.get(s.accountId);
      return {
        ...s,
        consentVersion: Math.max(...s.turns.map((t) => t.consentVersion || 0)),
        account: {
          id: account.id,
          label: account.label,
          department: account.department,
          country: account.country,
          office: account.office,
          tags: account.tags,
          enabled: account.enabled,
        },
        firstAt: s.turns[0].observedAt,
        lastAt: s.turns.at(-1).observedAt,
        lastReceivedAt: s.turns.reduce((n, t) => Math.max(n, Date.parse(t.receivedAt)), 0),
        hasGaps: indexes[0] !== 1 || indexes.some((n, i) => i > 0 && n !== indexes[i - 1] + 1),
        limited: s.turns.some(
          (t) =>
            t.promptTruncated ||
            t.responseTruncated ||
            t.modelLimited ||
            t.responseStatus !== 'complete',
        ),
        embeddingPrompts: semanticPrompts.length ? semanticPrompts : [prompts[0]],
        promptHash: digest(JSON.stringify(semanticPrompts.length ? semanticPrompts : [prompts[0]])),
        snapshotHash: digest(
          JSON.stringify(
            s.turns.map((t) => [
              t.id,
              t.redactedText,
              t.redactedResponse,
              t.responseStatus,
              t.promptTruncated,
              t.responseTruncated,
              t.modelLimited,
            ]),
          ),
        ),
        work: classifyWork(prompts.join('\n')),
        promptText: prompts.join('\n').slice(0, 12000),
        expiresAt:
          s.turns.reduce((n, t) => Math.max(n, Date.parse(t.receivedAt)), 0) +
          RETENTION.days * 86400000,
      };
    })
    .sort((a, b) => b.lastReceivedAt - a.lastReceivedAt || a.key.localeCompare(b.key));
}
export function selectSessions(sessions, filters = {}) {
  const from = filters.from ? Date.parse(filters.from) : -Infinity,
    to = filters.to ? Date.parse(filters.to) + 86400000 : Infinity,
    q = normalize(filters.query || '');
  return sessions.filter((s) => {
    const a = s.account;
    if (
      (filters.account && a.id !== filters.account) ||
      (filters.department && a.department !== filters.department) ||
      (filters.office && a.office !== filters.office) ||
      (filters.tag && !a.tags.includes(filters.tag)) ||
      (filters.category && s.work.primary !== filters.category) ||
      (filters.outcome && s.outcome.status !== filters.outcome)
    )
      return false;
    if (!s.turns.some((t) => Date.parse(t.receivedAt) >= from && Date.parse(t.receivedAt) < to))
      return false;
    return (
      !q ||
      q
        .split(/\s+/)
        .every((term) =>
          normalize(
            [
              a.label,
              a.department,
              a.office,
              ...a.tags,
              ...s.turns.flatMap((t) => [t.redactedText, t.redactedResponse || '']),
            ].join(' '),
          ).includes(term),
        )
    );
  });
}
export function sessionSummary(s) {
  const first =
    s.turns.find((t) => !acceptance(t.redactedText) && t.redactedText.length > 20) || s.turns[0];
  return {
    key: s.key,
    id: s.id,
    account: s.account,
    provider: s.turns[0].provider,
    model: s.turns.at(-1).model,
    channel: s.turns[0].channel,
    turnCount: s.turns.length,
    answerCount: s.turns.filter((t) => typeof t.redactedResponse === 'string').length,
    firstAt: s.firstAt,
    lastAt: s.lastAt,
    hasGaps: s.hasGaps,
    limited: s.limited,
    category: s.work.primary,
    concepts: s.work.concepts,
    preview: redact(first.redactedText).text.slice(0, 180),
    outcome: s.outcome,
  };
}
export function solutionFor(s) {
  const chosen =
    s.review && s.review.sourceHash === s.snapshotHash
      ? s.turns.find((t) => t.id === s.review.eventId)
      : null;
  const event =
    chosen ||
    s.turns.find(
      (t) =>
        t.redactedResponse &&
        t.responseStatus === 'complete' &&
        !acceptance(t.redactedText) &&
        t.redactedText.length > 35,
    );
  if (!event) return null;
  return {
    key: s.key,
    account: s.account,
    category: s.work.primary,
    title: s.work.concepts[0]?.label || CATEGORIES.find((c) => c.id === s.work.primary).label,
    status: s.outcome.status,
    source: s.outcome.source,
    evidence: s.outcome.evidence,
    eventId: event.id,
    prompt: redact(event.redactedText).text,
    response: redact(event.redactedResponse || '').text,
    complete: event.responseStatus === 'complete',
    limited: !!(event.promptTruncated || event.responseTruncated || event.modelLimited),
    lastAt: s.lastAt,
  };
}
