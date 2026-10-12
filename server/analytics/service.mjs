import {
  retainedState,
  buildSessions,
  evaluateOutcome,
  validateFilters,
  selectSessions,
  sessionSummary,
  solutionFor,
  normalize,
  CATEGORIES,
  OUTCOME_LABELS,
  RETENTION,
  MODEL_KEY,
  fail,
} from './domain.mjs';
import { semanticGraph } from './semantic.mjs';
import { redact } from '../../shared/analysis.mjs';
import { repositoryFor } from './repository.mjs';
const countBy = (items, key) => {
  const counts = new Map();
  for (const i of items) {
    const k = key(i);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
export class AnalyticsService {
  constructor(store, repository = repositoryFor(store)) {
    this.store = store;
    this.repository = repository;
  }
  async state() {
    return retainedState(
      await (this.store.read ? this.store.read((s) => s) : this.store.transact((s) => s)),
    );
  }
  async snapshot() {
    const state = await this.state(),
      sessions = buildSessions(state);
    await this.repository.reconcile(sessions, MODEL_KEY);
    const entries = await this.repository.entries(),
      reviews = new Map(entries.reviews.map((r) => [r.key, r]));
    for (const session of sessions) {
      session.review = reviews.get(session.key);
      session.outcome = evaluateOutcome(session, session.review);
    }
    return { state, sessions, documents: entries.documents, worker: entries.worker };
  }
  async dashboard(input = {}) {
    const filters = validateFilters(input),
      snapshot = await this.snapshot(),
      sessions = selectSessions(snapshot.sessions, filters),
      turns = sessions.flatMap((s) => s.turns),
      total = sessions.length;
    const categories = countBy(sessions, (s) => s.work.primary).map(([id, count]) => ({
      id,
      label: CATEGORIES.find((c) => c.id === id).label,
      sessions: count,
      validated: sessions.filter((s) => s.work.primary === id && s.outcome.status === 'validated')
        .length,
      turns: sessions.filter((s) => s.work.primary === id).reduce((n, s) => n + s.turns.length, 0),
    }));
    const outcomes = Object.entries(OUTCOME_LABELS).map(([id, label]) => ({
      id,
      label,
      count: sessions.filter((s) => s.outcome.status === id).length,
    }));
    const timeline = new Map();
    for (const turn of turns) {
      const day = turn.receivedAt.slice(0, 10);
      if ((filters.from && day < filters.from) || (filters.to && day > filters.to)) continue;
      if (!timeline.has(day)) timeline.set(day, { date: day, turns: 0, sessions: new Set() });
      const d = timeline.get(day);
      d.turns++;
      d.sessions.add(turn.installationId + ':' + (turn.conversationId || turn.id));
    }
    const processMap = new Map();
    for (const s of sessions) {
      const concepts = s.work.concepts.length
        ? s.work.concepts
        : [{ id: s.work.primary, label: CATEGORIES.find((c) => c.id === s.work.primary).label }];
      for (const concept of concepts) {
        if (!processMap.has(concept.id))
          processMap.set(concept.id, {
            id: concept.id,
            label: concept.label,
            sessions: [],
            accounts: new Set(),
            departments: new Set(),
          });
        const p = processMap.get(concept.id);
        p.sessions.push(s);
        p.accounts.add(s.accountId);
        p.departments.add(s.account.department);
      }
    }
    const processes = [...processMap.values()]
      .map((p) => ({
        id: p.id,
        label: p.label,
        sessions: p.sessions.length,
        accounts: p.accounts.size,
        departments: p.departments.size,
        validated: p.sessions.filter((s) => s.outcome.status === 'validated').length,
        positiveSignals: p.sessions.filter((s) => s.outcome.status === 'positive_signal').length,
        sessionKeys: p.sessions.slice(0, 5).map((s) => s.key),
        nextStep: p.sessions.some((s) => s.outcome.status === 'validated')
          ? 'Documentar una plantilla y validar el proceso con su responsable.'
          : 'Revisar ejemplos y confirmar utilidad antes de estandarizar.',
      }))
      .sort((a, b) => b.sessions - a.sessions || a.id.localeCompare(b.id));
    const solutions = sessions
      .filter((s) => ['validated', 'positive_signal'].includes(s.outcome.status))
      .map(solutionFor)
      .filter(Boolean)
      .sort(
        (a, b) =>
          (a.status === 'validated' ? -1 : 0) - (b.status === 'validated' ? -1 : 0) ||
          b.lastAt.localeCompare(a.lastAt),
      )
      .slice(0, 30);
    return {
      generatedAt: new Date().toISOString(),
      filters,
      retention: RETENTION,
      summary: {
        sessions: total,
        turns: turns.length,
        accounts: new Set(sessions.map((s) => s.accountId)).size,
        departments: new Set(sessions.map((s) => s.account.department)).size,
        answers: turns.filter((t) => typeof t.redactedResponse === 'string').length,
        completeAnswers: turns.filter((t) => t.redactedResponse && t.responseStatus === 'complete')
          .length,
        validated: outcomes.find((o) => o.id === 'validated').count,
        positiveSignals: outcomes.find((o) => o.id === 'positive_signal').count,
        unknown: outcomes.find((o) => o.id === 'unknown').count,
      },
      categories,
      outcomes,
      activity: [...timeline.values()]
        .map((d) => ({ ...d, sessions: d.sessions.size }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      teams: countBy(sessions, (s) => s.account.department).map(([department, count]) => ({
        department,
        sessions: count,
        accounts: new Set(
          sessions.filter((s) => s.account.department === department).map((s) => s.accountId),
        ).size,
      })),
      processes,
      solutions,
      sessions: sessions.slice(0, 100).map(sessionSummary),
      sessionListOmitted: Math.max(0, total - 100),
      semantic: { ...semanticGraph(sessions, snapshot.documents), worker: snapshot.worker },
      facets: {
        departments: [...new Set(snapshot.state.accounts.map((a) => a.department))].sort(),
        offices: [...new Set(snapshot.state.accounts.map((a) => a.office))].sort(),
        tags: [...new Set(snapshot.state.accounts.flatMap((a) => a.tags))].sort(),
        categories: CATEGORIES,
      },
      interpretation: {
        success:
          'Una respuesta completa no prueba éxito. La aceptación explícita es una señal; una solución validada requiere revisión humana.',
        sample: 'Solo se analiza el historial autorizado y retenido; no se mide productividad.',
        period:
          'El período selecciona sesiones con actividad recibida en ese rango. Se evalúa todo su contexto retenido.',
      },
    };
  }
  async directory(input = {}) {
    const state = await this.state(),
      sessions = buildSessions(state),
      query = normalize(input.query || '').trim();
    if (query.length > 200) fail(400, 'Búsqueda demasiado larga.');
    const page = Number(input.page || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) fail(400, 'Página inválida.');
    const all = state.accounts
      .filter(
        (a) =>
          (!input.department || a.department === input.department) &&
          (!query ||
            query
              .split(/\s+/)
              .every((t) =>
                normalize(
                  [a.id, a.label, a.department, a.country, a.office, ...a.tags].join(' '),
                ).includes(t),
              )),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
    const accounts = all.slice(page * 20, page * 20 + 20).map((a) => {
      const own = sessions.filter((s) => s.accountId === a.id),
        i = state.installations.find((i) => i.accountId === a.id);
      return {
        id: a.id,
        label: a.label,
        department: a.department,
        country: a.country,
        office: a.office,
        tags: a.tags,
        enabled: a.enabled,
        sessions: own.length,
        turns: own.reduce((n, s) => n + s.turns.length, 0),
        lastActivity: own[0] ? new Date(own[0].lastReceivedAt).toISOString() : null,
        installation: i
          ? {
              lastSeen: i.lastSeen,
              reachable: !!i.lastSeen && Date.now() - Date.parse(i.lastSeen) < 90000,
              state: i.state,
              consent: i.consent,
            }
          : null,
      };
    });
    return {
      accounts,
      page,
      pageSize: 20,
      total: all.length,
      hasMore: (page + 1) * 20 < all.length,
      departments: [...new Set(state.accounts.map((a) => a.department))].sort(),
    };
  }
  async session(input) {
    const snapshot = await this.snapshot(),
      session = snapshot.sessions.find((s) => s.key === input.key);
    if (!session) fail(404, 'Sesión no disponible.');
    if (input.version && input.version !== session.snapshotHash)
      fail(409, 'La sesión cambió. Abre una nueva revisión.');
    const after = Number(input.afterTurn || 0);
    if (!Number.isSafeInteger(after) || after < 0) fail(400, 'Cursor inválido.');
    const remaining = session.turns.filter((t) => (t.turnIndex || 1) > after),
      turns = remaining
        .slice(0, 25)
        .map((t) => ({
          ...t,
          redactedText: redact(t.redactedText).text,
          ...(typeof t.redactedResponse === 'string'
            ? { redactedResponse: redact(t.redactedResponse).text }
            : {}),
        }));
    return {
      session: sessionSummary(session),
      version: session.snapshotHash,
      turns,
      nextAfterTurn: remaining.length > turns.length ? turns.at(-1).turnIndex || 1 : null,
    };
  }
  async review(input) {
    if (
      !input ||
      typeof input.key !== 'string' ||
      !['validated', 'rejected', 'uncertain'].includes(input.decision) ||
      typeof input.note !== 'string' ||
      input.note.length > 1200
    )
      fail(400, 'Revisión inválida.');
    const state = await this.state(),
      session = buildSessions(state).find((s) => s.key === input.key);
    if (!session) fail(404, 'La sesión ya no está disponible.');
    if (input.version !== session.snapshotHash)
      fail(409, 'La sesión cambió. Actualiza antes de revisar.');
    const selected =
      session.turns.find((t) => t.id === input.eventId) ||
      session.turns.find((t) => t.redactedResponse && t.responseStatus === 'complete');
    if (!selected) fail(400, 'Selecciona un turno con respuesta disponible.');
    if (input.eventId && !session.turns.some((t) => t.id === input.eventId))
      fail(400, 'El turno no pertenece a la sesión.');
    if (
      input.decision === 'validated' &&
      (!selected.redactedResponse ||
        selected.responseStatus !== 'complete' ||
        selected.promptTruncated ||
        selected.responseTruncated ||
        selected.modelLimited ||
        session.hasGaps ||
        session.limited)
    )
      fail(400, 'No se puede validar una solución con captura incompleta o sin respuesta.');
    if (input.note.trim().length < 10)
      fail(400, 'Describe la evidencia de tu revisión en al menos 10 caracteres.');
    await this.repository.review(session, {
      eventId: selected.id,
      decision: input.decision,
      note: redact(input.note).text,
    });
    // Do not return cached content if erasure/retention won a concurrent race.
    const current = buildSessions(await this.state()).find((s) => s.key === session.key);
    if (!current) {
      await this.repository.removeReview(session.key, session.snapshotHash);
      fail(409, 'La sesión fue retirada durante la revisión.');
    }
    return { saved: true, stale: current.snapshotHash !== session.snapshotHash };
  }
}
