import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Network,
  Library,
  FileDown,
  RefreshCw,
  Search,
  ArrowUpRight,
  CheckCircle2,
  MessageSquare,
  ShieldCheck,
  Target,
  Layers,
  Users,
} from 'lucide-react';
import { api } from './api';
import { AccountPicker } from './components/account-directory';
import { ReviewDialog, ExportDialog } from './analytics-dialogs';
import type {
  DashboardData,
  Filters,
  Graph,
  SessionSummary,
  OutcomeStatus,
} from './analytics-types';
import { formatShortDate } from './format';
import './analytics.css';
const emptyFilters: Filters = {
  account: '',
  department: '',
  office: '',
  tag: '',
  category: '',
  outcome: '',
  query: '',
  from: '',
  to: '',
};
const statusLabels: Record<OutcomeStatus, string> = {
  validated: 'Validada',
  positive_signal: 'Señal positiva',
  needs_revision: 'Revisión',
  technical_issue: 'Incidencia',
  unknown: 'Sin evidencia',
};
const colors = ['#487c6a', '#679daa', '#b59363', '#8b80ac', '#719755', '#b37674', '#537b96'];
function ActivityChart({ data }: { data: DashboardData['activity'] }) {
  const max = Math.max(1, ...data.map((d) => d.turns));
  return (
    <div
      className="activity-chart"
      role="img"
      aria-label={
        data.map((d) => `${d.date}: ${d.turns} turnos`).join('; ') || 'No hay actividad recibida'
      }
    >
      {data.length ? (
        data.map((day) => (
          <div className="activity-column" key={day.date}>
            <strong>{day.turns}</strong>
            <div className="activity-track">
              <span style={{ height: `${Math.max(2, (day.turns / max) * 100)}%` }} />
            </div>
            <small>{day.date.slice(5)}</small>
          </div>
        ))
      ) : (
        <div className="analytics-empty">La actividad aparece al recibir aportes autorizados.</div>
      )}
    </div>
  );
}
function SemanticMap({ graph, onOpen }: { graph: Graph; onOpen: (key: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const positions = useMemo(() => {
    const groups = [...new Set(graph.nodes.map((n) => n.group))];
    const map = new Map<string, { x: number; y: number }>();
    groups.forEach((g, i) => {
      const angle = (i / Math.max(1, groups.length)) * Math.PI * 2,
        center = { x: 450 + Math.cos(angle) * 240, y: 250 + Math.sin(angle) * 155 },
        members = graph.nodes.filter((n) => n.group === g);
      members.forEach((n, j) => {
        const a = (j / Math.max(1, members.length)) * Math.PI * 2;
        map.set(n.key, {
          x: center.x + (members.length > 1 ? Math.cos(a) * 58 : 0),
          y: center.y + (members.length > 1 ? Math.sin(a) * 58 : 0),
        });
      });
    });
    return map;
  }, [graph.nodes]);
  const node = graph.nodes.find((n) => n.key === selected),
    edges = graph.edges.filter((e) => !selected || e.source === selected || e.target === selected),
    neighbors = new Set(edges.flatMap((e) => [e.source, e.target]));
  return (
    <div className="semantic-layout">
      <div className="semantic-canvas">
        {graph.nodes.length ? (
          <svg viewBox="0 0 900 500" aria-label="Mapa semántico de sesiones">
            <defs>
              <pattern id="semantic-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#dce4df" />
              </pattern>
            </defs>
            <rect width="900" height="500" fill="url(#semantic-grid)" />
            {graph.edges.map((e) => {
              const a = positions.get(e.source),
                b = positions.get(e.target);
              return a && b ? (
                <line
                  key={e.source + e.target}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={edges.includes(e) ? '#7fa397' : '#e0e8e2'}
                  strokeWidth={edges.includes(e) ? 2 : 1}
                >
                  <title>Similitud coseno {e.similarity.toFixed(2)}</title>
                </line>
              ) : null;
            })}
            {graph.nodes.map((n) => {
              const p = positions.get(n.key)!;
              return (
                <g
                  key={n.key}
                  role="button"
                  tabIndex={0}
                  aria-label={n.accountLabel + ': ' + n.preview}
                  onClick={() => setSelected(n.key === selected ? null : n.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(n.key);
                    }
                  }}
                  className="semantic-node"
                  opacity={selected && !neighbors.has(n.key) ? 0.35 : 1}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={Math.min(19, 11 + n.turns)}
                    fill={colors[n.group % colors.length]}
                    stroke={n.status === 'validated' ? '#233e33' : 'white'}
                    strokeWidth={n.key === selected ? 5 : 2}
                  />
                  <text x={p.x} y={p.y + 31} textAnchor="middle">
                    {n.accountLabel}
                  </text>
                  <title>{n.preview}</title>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="semantic-pending">
            <Network size={40} />
            <h3>
              {graph.totalSessions
                ? graph.executionMode === 'vercel_on_demand'
                  ? 'Preparando el índice en Vercel'
                  : graph.worker?.recent
                    ? 'El worker privado prepara el índice'
                    : 'El índice espera al worker privado'
                : 'Las relaciones comienzan con el primer aporte'}
            </h3>
            <p>
              {graph.totalSessions
                ? `${graph.pending} sesiones en cola. El worker privado calcula embeddings multilingües; no se inventan vínculos mientras faltan vectores.`
                : 'Recibe conversaciones autorizadas para vincular intenciones y encontrar necesidades comunes.'}
            </p>
          </div>
        )}
        <div className="semantic-caption">
          Cada nodo es una sesión. Las líneas vinculan intenciones similares; no representan éxito.
        </div>
      </div>
      <aside className="semantic-inspector">
        <div className="analytics-eyebrow">EXPLORAR RELACIONES</div>
        {node ? (
          <>
            <h3>{node.accountLabel}</h3>
            <p>{node.department}</p>
            <blockquote>{node.preview}</blockquote>
            <span className={'outcome-badge ' + node.status}>{statusLabels[node.status]}</span>
            <button className="text-button" onClick={() => onOpen(node.key)}>
              Abrir conversación
              <ArrowUpRight size={16} />
            </button>
            <h4>Sesiones relacionadas</h4>
            {edges.map((e) => {
              const other = graph.nodes.find(
                (n) => n.key === (e.source === node.key ? e.target : e.source),
              );
              return other ? (
                <button
                  className="related-session"
                  key={other.key}
                  onClick={() => setSelected(other.key)}
                >
                  <strong>
                    {other.accountLabel}
                    <span>{e.similarity.toFixed(2)}</span>
                  </strong>
                  <small>{other.preview}</small>
                </button>
              ) : null;
            })}
            {!edges.length && (
              <p className="analytics-note">No hay vecinos mutuos por encima del umbral actual.</p>
            )}
          </>
        ) : (
          <>
            <h3>Encuentra el trabajo que conecta a los equipos</h3>
            <p>
              Selecciona un nodo para revisar su intención y ver sesiones similares de otras
              cuentas.
            </p>
            {graph.clusters
              .filter((c) => c.sessionKeys.some((key) => graph.nodes.some((n) => n.key === key)))
              .slice(0, 6)
              .map((c) => (
                <button
                  className="semantic-cluster"
                  key={c.id}
                  onClick={() =>
                    setSelected(
                      c.sessionKeys.find((key) => graph.nodes.some((n) => n.key === key)) || null,
                    )
                  }
                >
                  <strong>{c.label}</strong>
                  <small>
                    {c.sessions} sesiones · {c.accounts} cuentas
                  </small>
                </button>
              ))}
          </>
        )}
        <div className="analytics-note">
          Umbral coseno: {graph.threshold}. Hasta tres vecinos mutuos por sesión. {graph.scope}
        </div>
      </aside>
    </div>
  );
}
export function AnalyticsDashboard({
  onOpenConversation,
  active = true,
}: {
  onOpenConversation: (key: string) => void;
  active?: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [view, setView] = useState('overview'),
    [data, setData] = useState<DashboardData | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [review, setReview] = useState<SessionSummary | null>(null),
    [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    setLoading(true);
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const d = await api<DashboardData>(
          'analytics?' + new URLSearchParams(filters),
          'GET',
          undefined,
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setData(d);
          setError('');
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        pending = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    const debounce = setTimeout(load, 250),
      interval = setInterval(load, 30000);
    return () => {
      abort.abort();
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [filters, revision, active]);
  const setFilter = (key: keyof Filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const categoryLabel = (id: string) =>
    data?.facets.categories.find((c) => c.id === id)?.label || id;
  const maxCategory = Math.max(1, ...(data?.categories.map((c) => c.sessions) || []));
  return (
    <div className="analytics-dashboard">
      <div className="analytics-heading">
        <div>
          <div className="analytics-eyebrow">INTELIGENCIA DE USO · GOBIERNO CORPORATIVO</div>
          <h1>Entiende el trabajo. Encuentra la próxima mejora.</h1>
          <p>
            Conecta conversaciones, valida soluciones y convierte aprendizajes en procesos
            compartidos.
          </p>
        </div>
        <div className="analytics-heading-actions">
          <button
            className="secondary"
            onClick={() => setRevision((n) => n + 1)}
            aria-label="Actualizar análisis"
          >
            <RefreshCw size={16} />
          </button>
          <button className="primary" onClick={() => setExportOpen(true)}>
            <FileDown size={16} />
            Exportar Parquet
          </button>
        </div>
      </div>
      <section className="analytics-filters" aria-label="Filtros del análisis">
        <AccountPicker
          value={filters.account}
          label={data?.sessions.find((s) => s.account.id === filters.account)?.account.label}
          onChange={(a) => setFilter('account', a?.id || '')}
        />
        <label>
          Departamento
          <select
            value={filters.department}
            onChange={(e) => setFilter('department', e.target.value)}
          >
            <option value="">Todos los equipos</option>
            {data?.facets.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Sucursal
          <select value={filters.office} onChange={(e) => setFilter('office', e.target.value)}>
            <option value="">Todas las sucursales</option>
            {data?.facets.offices.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Etiqueta
          <select value={filters.tag} onChange={(e) => setFilter('tag', e.target.value)}>
            <option value="">Todas las etiquetas</option>
            {data?.facets.tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        <label className="analytics-search">
          <Search size={17} />
          <input
            aria-label="Buscar usos de IA"
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
            placeholder="Buscar una tarea, necesidad o contenido de conversación"
          />
        </label>
        <button className="text-button" onClick={() => setFilters(emptyFilters)}>
          Limpiar filtros
        </button>
      </section>
      <div className="analytics-context" aria-live="polite">
        <span>
          {loading
            ? 'Actualizando análisis…'
            : `Última actualización ${formatShortDate(data?.generatedAt || null)}`}
        </span>
        <span>
          Muestra voluntaria · {data?.retention.days || 7} días · hasta{' '}
          {data?.retention.maxTurns || 500} turnos
        </span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <nav className="analytics-tabs" aria-label="Vistas del análisis">
        {[
          { id: 'overview', label: 'Usos y resultados', icon: BarChart3 },
          { id: 'semantic', label: 'Mapa semántico', icon: Network },
          { id: 'solutions', label: 'Biblioteca de soluciones', icon: Library },
        ].map((t) => (
          <button
            key={t.id}
            className={view === t.id ? 'active' : ''}
            onClick={() => setView(t.id)}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </nav>
      {!data ? (
        <div className="panel analytics-empty">
          {error
            ? 'El análisis no pudo cargarse. Actualiza para volver a intentar.'
            : 'Preparando el panorama de uso…'}
        </div>
      ) : (
        <>
          <div className="analytics-metrics">
            {[
              {
                label: 'Sesiones observadas',
                value: data.summary.sessions,
                detail: `${data.summary.turns} turnos de contexto retenido`,
                icon: MessageSquare,
              },
              {
                label: 'Cuentas participantes',
                value: data.summary.accounts,
                detail: `${data.summary.departments} departamentos en esta muestra`,
                icon: Users,
              },
              {
                label: 'Soluciones validadas',
                value: data.summary.validated,
                detail: 'Confirmadas mediante revisión humana',
                icon: CheckCircle2,
              },
              {
                label: 'Señales de aceptación',
                value: data.summary.positiveSignals,
                detail: 'Indicios del usuario; pendientes de validar',
                icon: Target,
              },
            ].map((m) => (
              <article key={m.label}>
                <div>
                  <span>{m.label}</span>
                  <m.icon size={18} />
                </div>
                <strong>{m.value}</strong>
                <small>{m.detail}</small>
              </article>
            ))}
          </div>
          {view === 'overview' && (
            <>
              <div className="analytics-panels">
                <section className="analytics-panel">
                  <div className="analytics-panel-title">
                    <div>
                      <h2>¿Qué trabajo se está haciendo con IA?</h2>
                      <p>Categoría principal por sesión. Pulsa una para explorar.</p>
                    </div>
                    <Layers size={21} />
                  </div>
                  <div className="category-bars">
                    {data.categories.map((c) => (
                      <button
                        className={filters.category === c.id ? 'selected' : ''}
                        key={c.id}
                        onClick={() => setFilter('category', filters.category === c.id ? '' : c.id)}
                      >
                        <div>
                          <span>{c.label}</span>
                          <strong>{c.sessions}</strong>
                        </div>
                        <div className="category-track">
                          <span style={{ width: `${(c.sessions / maxCategory) * 100}%` }} />
                        </div>
                        <small>
                          {c.turns} turnos · {c.validated} soluciones validadas
                        </small>
                      </button>
                    ))}
                    {!data.categories.length && (
                      <div className="analytics-empty">
                        Las categorías aparecerán con el primer aporte.
                      </div>
                    )}
                  </div>
                </section>
                <section className="analytics-panel">
                  <div className="analytics-panel-title">
                    <div>
                      <h2>Actividad recibida</h2>
                      <p>Volumen de aportes; no una medida de productividad.</p>
                    </div>
                    <BarChart3 size={21} />
                  </div>
                  <ActivityChart data={data.activity} />
                  <div className="answer-coverage">
                    <strong>
                      {data.summary.answers} / {data.summary.turns}
                    </strong>
                    <span>turnos con respuesta compartida</span>
                    <small>La cobertura condiciona lo que puede evaluarse.</small>
                  </div>
                </section>
              </div>
              <section className="analytics-panel">
                <div className="analytics-panel-title">
                  <div>
                    <h2>Resultados con evidencia</h2>
                    <p>{data.interpretation.success}</p>
                  </div>
                </div>
                <div className="outcome-grid">
                  {data.outcomes.map((o) => (
                    <button
                      key={o.id}
                      className={filters.outcome === o.id ? 'selected' : ''}
                      onClick={() => setFilter('outcome', filters.outcome === o.id ? '' : o.id)}
                    >
                      <span className={'outcome-dot ' + o.id} />
                      <strong>{o.count}</strong>
                      <span>{o.label}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="analytics-panel process-panel">
                <div className="analytics-panel-title">
                  <div>
                    <h2>Procesos que merecen una mejora</h2>
                    <p>
                      Necesidades recurrentes y oportunidades para revisar con sus responsables.
                    </p>
                  </div>
                </div>
                <div className="process-grid">
                  {data.processes.slice(0, 8).map((p) => (
                    <article key={p.id}>
                      <div className="process-title">
                        <Layers size={20} />
                        <span>{p.sessions} sesiones</span>
                      </div>
                      <h3>{p.label}</h3>
                      <p>
                        {p.accounts} cuentas · {p.departments} departamentos
                      </p>
                      <div className="process-evidence">
                        <strong>{p.validated}</strong> soluciones validadas · {p.positiveSignals}{' '}
                        señales positivas
                      </div>
                      <small>{p.nextStep}</small>
                      <button
                        className="text-button"
                        onClick={() => onOpenConversation(p.sessionKeys[0])}
                      >
                        Revisar un ejemplo
                        <ArrowUpRight size={15} />
                      </button>
                    </article>
                  ))}
                </div>
                {!data.processes.length && (
                  <div className="analytics-empty">Sin patrones en la muestra seleccionada.</div>
                )}
                <div className="analytics-note">
                  Una sesión puede aparecer en varios procesos. La recurrencia identifica una
                  oportunidad para investigar, no demuestra ahorro.
                </div>
              </section>
            </>
          )}
          {view === 'semantic' && (
            <section className="analytics-panel">
              <div className="analytics-panel-title">
                <div>
                  <h2>Intenciones similares, aprendizajes compartidos</h2>
                  <p>
                    {data.semantic.executionMode === 'vercel_on_demand'
                      ? 'Modelo propio en CPU dentro del backend privado de Vercel.'
                      : 'Embeddings multilingües calculados por el worker privado.'}
                  </p>
                </div>
                <span className="index-coverage">
                  {data.semantic.indexedSessions} / {data.semantic.totalSessions} sesiones indexadas
                </span>
              </div>
              <SemanticMap graph={data.semantic} onOpen={onOpenConversation} />
              <div className="analytics-note">
                {data.semantic.executionMode === 'vercel_on_demand'
                  ? 'Procesamiento bajo demanda en Vercel: no requiere un computador encendido. '
                  : data.semantic.worker
                    ? `Último reporte del worker: ${new Date(data.semantic.worker.lastSeen).toLocaleString('es-CL')}. ${data.semantic.worker.recent ? 'Reporte reciente.' : 'Sin reporte reciente; comprueba el servicio privado.'}`
                    : 'Aún no hay reportes de un worker privado.'}{' '}
                Modelo: {data.semantic.model}. Se muestran {data.semantic.visibleSessions} sesiones.
                {data.semantic.omittedNodes > 0
                  ? ` ${data.semantic.omittedNodes} nodos adicionales no se dibujan: reduce el rango o aplica filtros.`
                  : ''}{' '}
                {data.semantic.failed > 0
                  ? `${data.semantic.failed} trabajos requieren revisar el worker.`
                  : ''}{' '}
                {data.semantic.layout}
              </div>
            </section>
          )}
          {view === 'solutions' && (
            <section className="analytics-panel">
              <div className="analytics-panel-title">
                <div>
                  <h2>Prompts y soluciones que vale la pena reutilizar</h2>
                  <p>
                    Valida calidad y condiciones de uso antes de convertir un ejemplo en una
                    práctica corporativa.
                  </p>
                </div>
              </div>
              <div className="solution-grid">
                {data.solutions.map((s) => (
                  <article key={s.key}>
                    <div className="solution-status">
                      <span className={'outcome-badge ' + s.status}>
                        {s.status === 'validated'
                          ? 'Validada por una persona'
                          : 'Candidata · señal de aceptación'}
                      </span>
                      <small>{categoryLabel(s.category)}</small>
                    </div>
                    <h3>{s.title}</h3>
                    <p>
                      {s.account.label} · {s.account.department}
                    </p>
                    <div className="solution-prompt">
                      <span>Solicitud de referencia</span>
                      <pre>{s.prompt}</pre>
                    </div>
                    <details>
                      <summary>Ver la respuesta y su evidencia</summary>
                      <pre>{s.response}</pre>
                      <blockquote>{s.evidence}</blockquote>
                    </details>
                    <div className="solution-actions">
                      <button className="text-button" onClick={() => onOpenConversation(s.key)}>
                        Conversación
                        <ArrowUpRight size={15} />
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const session = data.sessions.find((x) => x.key === s.key);
                          if (session) setReview(session);
                        }}
                        disabled={!data.sessions.some((x) => x.key === s.key)}
                      >
                        Revisar utilidad
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!data.solutions.length && (
                <div className="analytics-empty">
                  <Library size={30} />
                  <h3>Una biblioteca sustentada en evidencia</h3>
                  <p>
                    Revisa una sesión o recibe una señal explícita de aceptación. No se presentan
                    respuestas genéricas como soluciones exitosas.
                  </p>
                </div>
              )}
            </section>
          )}
          <section className="analytics-panel session-ledger">
            <div className="analytics-panel-title">
              <div>
                <h2>Sesiones para explorar y validar</h2>
                <p>Contexto, resultado y evidencia de cada conversación.</p>
              </div>
              <div className="session-category-filter">
                <select
                  aria-label="Filtrar categoría"
                  value={filters.category}
                  onChange={(e) => setFilter('category', e.target.value)}
                >
                  <option value="">Todas las categorías</option>
                  {data.facets.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>Cuenta y trabajo</th>
                    <th>Categoría</th>
                    <th>Contexto</th>
                    <th>Resultado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <tr key={s.key}>
                      <td>
                        <strong>{s.account.label}</strong>
                        <small>
                          {s.account.department} · {s.account.office}
                        </small>
                        <p className="session-preview">{s.preview}</p>
                      </td>
                      <td>
                        {categoryLabel(s.category)}
                        <small>
                          {s.provider} · {s.model}
                        </small>
                      </td>
                      <td>
                        {s.turnCount} turnos<small>{s.answerCount} respuestas</small>
                        {s.limited && <small>Captura con límites</small>}
                      </td>
                      <td>
                        <span className={'outcome-badge ' + s.outcome.status}>
                          {s.outcome.label}
                        </span>
                        <small>
                          {s.outcome.reviewStale
                            ? 'Revisión anterior desactualizada'
                            : s.outcome.source === 'human_review'
                              ? 'Revisión humana'
                              : s.outcome.source === 'user_statement'
                                ? 'Declaración del usuario'
                                : s.outcome.source === 'provider_status'
                                  ? 'Estado del proveedor'
                                  : 'Sin confirmación'}
                        </small>
                      </td>
                      <td>
                        <button className="text-button" onClick={() => onOpenConversation(s.key)}>
                          Abrir
                          <ArrowUpRight size={14} />
                        </button>
                        <button className="review-session-button" onClick={() => setReview(s)}>
                          Evaluar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.sessions.length && (
              <div className="analytics-empty">No hay sesiones con estos filtros.</div>
            )}
            {data.sessionListOmitted > 0 && (
              <p className="analytics-note">
                Se muestran las 100 sesiones más recientes de la selección;{' '}
                {data.sessionListOmitted} adicionales están incluidas en los agregados y la
                exportación.
              </p>
            )}
          </section>
          <div className="analytics-disclosure">
            <ShieldCheck size={17} />
            <p>
              {data.interpretation.sample} {data.interpretation.period}
            </p>
          </div>
        </>
      )}
      {review && (
        <ReviewDialog
          session={review}
          onClose={() => setReview(null)}
          onSaved={() => setRevision((n) => n + 1)}
        />
      )}
      {exportOpen && <ExportDialog filters={filters} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
