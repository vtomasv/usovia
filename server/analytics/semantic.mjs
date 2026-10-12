import { MODEL_ID, MODEL_KEY } from './domain.mjs';
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0,
    an = 0,
    bn = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    an += a[i] * a[i];
    bn += b[i] * b[i];
  }
  return an && bn ? dot / Math.sqrt(an * bn) : 0;
}
export function semanticGraph(sessions, documents, { threshold = 0.72, maxNodes = 80 } = {}) {
  const index = new Map(
    documents.filter((d) => d.status === 'ready' && d.model === MODEL_KEY).map((d) => [d.key, d]),
  );
  const ready = sessions.filter((s) => index.get(s.key)?.sourceHash === s.promptHash),
    visible = ready.slice(0, maxNodes),
    neighbors = new Map(ready.map((s) => [s.key, []]));
  for (let i = 0; i < ready.length; i++)
    for (let j = i + 1; j < ready.length; j++) {
      const similarity = cosine(index.get(ready[i].key).vector, index.get(ready[j].key).vector);
      if (similarity >= threshold) {
        neighbors.get(ready[i].key).push({ key: ready[j].key, similarity });
        neighbors.get(ready[j].key).push({ key: ready[i].key, similarity });
      }
    }
  for (const [key, list] of neighbors)
    neighbors.set(
      key,
      list.sort((a, b) => b.similarity - a.similarity || a.key.localeCompare(b.key)).slice(0, 3),
    );
  const edges = [];
  for (const [key, list] of neighbors)
    for (const n of list)
      if (key < n.key && neighbors.get(n.key).some((x) => x.key === key))
        edges.push({ source: key, target: n.key, similarity: Number(n.similarity.toFixed(4)) });
  const grouped = new Map();
  let group = 0;
  for (const s of ready)
    if (!grouped.has(s.key)) {
      const pending = [s.key];
      grouped.set(s.key, group);
      while (pending.length) {
        const key = pending.pop();
        for (const edge of edges) {
          const neighbor =
            edge.source === key ? edge.target : edge.target === key ? edge.source : null;
          if (neighbor && !grouped.has(neighbor)) {
            grouped.set(neighbor, group);
            pending.push(neighbor);
          }
        }
      }
      group++;
    }
  const nodes = visible.map((s) => ({
    key: s.key,
    accountId: s.accountId,
    accountLabel: s.account.label,
    department: s.account.department,
    category: s.work.primary,
    status: s.outcome.status,
    turns: s.turns.length,
    preview: s.turns[0].redactedText.slice(0, 100),
    group: grouped.get(s.key),
  }));
  const clusters = Array.from({ length: group }, (_, id) => {
    const members = ready.filter((s) => grouped.get(s.key) === id);
    return {
      id,
      sessionKeys: members.map((s) => s.key),
      sessions: members.length,
      accounts: new Set(members.map((s) => s.accountId)).size,
      label: members[0]?.work.concepts[0]?.label || 'Relación por intención',
    };
  }).filter((c) => c.sessions > 1);
  const relevant = new Set(sessions.map((s) => s.key));
  const queued = documents.filter((d) => relevant.has(d.key) && d.status !== 'ready');
  const visibleKeys = new Set(visible.map((s) => s.key));
  return {
    method: 'multilingual_embeddings',
    model: MODEL_ID,
    threshold,
    indexedSessions: ready.length,
    totalSessions: sessions.length,
    visibleSessions: visible.length,
    omittedNodes: Math.max(0, ready.length - visible.length),
    pending: queued.filter((d) => d.status !== 'failed').length,
    failed: queued.filter((d) => d.status === 'failed').length,
    nodes,
    edges: edges.filter((e) => visibleKeys.has(e.source) && visibleKeys.has(e.target)),
    clusters,
    layout: 'La posición organiza grupos; las distancias visuales no son puntuaciones.',
    scope:
      'Enlaces por similitud coseno y tres vecinos mutuos. No demuestran equivalencia ni calidad.',
  };
}
