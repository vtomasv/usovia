import { useEffect, useState, useRef } from 'react';
import { api } from './api';
import { MessageSquare, RefreshCw, Search, ShieldCheck, Users, ChevronRight } from 'lucide-react';
import type { Account } from './types';
type Turn = {
  id: string;
  turnIndex?: number;
  observedAt: string;
  finishedAt?: string;
  redactedText: string;
  redactedResponse?: string;
  responseStatus?: string;
  promptTruncated?: boolean;
  responseTruncated?: boolean;
  modelLimited?: boolean;
  provider: string;
  model: string;
  label: string;
  upstreamStatus?: number;
  redactions: number;
  responseRedactions?: number;
};
type Conversation = {
  key: string;
  id: string;
  accountId: string;
  provider: string;
  model: string;
  channel: string;
  sessionSource: string;
  firstAt: string;
  lastAt: string;
  hasGaps: boolean;
  limited: boolean;
  turnCount: number;
  preview: string;
  turns: Turn[];
};
type Group = {
  key: string;
  label: string;
  accounts: number;
  conversations: number;
  turns: number;
  answers: number;
};
type Result = {
  accounts: Account[];
  conversations: Conversation[];
  groups: Group[];
  totalTurns: number;
  retention: { days: number; maxTurns: number };
};
type ConversationPage = {
  conversation: Conversation;
  nextAfterTurn: number | null;
  snapshotAt: string;
};
const statuses: Record<string, string> = {
  not_authorized: 'El colaborador no autorizó compartir la respuesta',
  unsupported: 'El formato de respuesta todavía no tiene un adaptador compatible',
  incomplete: 'El stream terminó sin confirmar su finalización',
  aborted: 'La conexión se interrumpió',
  error: 'El proveedor devolvió un error',
  truncated: 'Respuesta capturada parcialmente',
  complete: 'Respuesta capturada',
};
const sources: Record<string, string> = {
  explicit: 'Conversación de Usovia',
  provider: 'Sesión identificada por el proveedor',
  history: 'Continuidad verificada por historial',
  independent: 'Consulta independiente · sin continuidad verificable',
};
const count = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;
const date = (value: string) => new Date(value).toLocaleString('es-CL');
export function Conversations() {
  const [detail, setDetail] = useState<Conversation | null>(null),
    [nextTurn, setNextTurn] = useState<number | null>(null),
    [snapshotAt, setSnapshotAt] = useState(''),
    [detailLoading, setDetailLoading] = useState(false);
  const [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(''),
    [account, setAccount] = useState(''),
    [department, setDepartment] = useState(''),
    [office, setOffice] = useState(''),
    [tag, setTag] = useState(''),
    [query, setQuery] = useState(''),
    [groupBy, setGroupBy] = useState('account'),
    [selected, setSelected] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const params = new URLSearchParams({ account, department, office, tag, query, groupBy });
        const body = await api<Result>('conversations?' + params, 'GET', undefined, {
          signal: abort.signal,
          errorMessage: 'No se pudieron consultar las conversaciones.',
        });
        if (!abort.signal.aborted) {
          setData(body);
          setError('');
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        pending = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    setLoading(true);
    const debounce = setTimeout(load, 200),
      timer = setInterval(load, 10000);
    return () => {
      abort.abort();
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [account, department, office, tag, query, groupBy, revision]);
  const accounts = data?.accounts || [],
    distinct = (key: 'department' | 'office') => [...new Set(accounts.map((a) => a[key]))].sort(),
    tags = [...new Set(accounts.flatMap((a) => a.tags))].sort();
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  useEffect(() => {
    setDetail(null);
    setNextTurn(null);
    setSnapshotAt('');
    if (!selected) return;
    const abort = new AbortController();
    setDetailLoading(true);
    (async () => {
      try {
        const body = await api<ConversationPage>(
          'conversations?' + new URLSearchParams({ conversation: selected }),
          'GET',
          undefined,
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setDetail(body.conversation);
          setNextTurn(body.nextAfterTurn);
          setSnapshotAt(body.snapshotAt);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setDetailLoading(false);
      }
    })();
    return () => abort.abort();
  }, [selected, revision]);
  async function more() {
    if (!selected || nextTurn === null || detailLoading) return;
    const key = selected;
    setDetailLoading(true);
    try {
      const body = await api<ConversationPage>(
        'conversations?' +
          new URLSearchParams({ conversation: key, afterTurn: String(nextTurn), snapshotAt }),
      );
      if (selectionRef.current !== key) return;
      setDetail((current) =>
        current?.key === key
          ? {
              ...current,
              turns: [
                ...current.turns,
                ...body.conversation.turns.filter(
                  (t: Turn) => !current.turns.some((x) => x.id === t.id),
                ),
              ],
            }
          : current,
      );
      setNextTurn(body.nextAfterTurn);
    } catch (e) {
      if (selectionRef.current === key) setError((e as Error).message);
    } finally {
      if (selectionRef.current === key) setDetailLoading(false);
    }
  }
  const conversation = data?.conversations.some((c) => c.key === selected) ? detail : null,
    owner = accounts.find((a) => a.id === conversation?.accountId);
  function chooseGroup(g: Group) {
    if (groupBy === 'account') setAccount(g.key);
    else if (groupBy === 'department') setDepartment(g.key);
    else if (groupBy === 'office') setOffice(g.key);
    else if (g.key !== 'Sin etiqueta') setTag(g.key);
    setSelected(null);
  }
  function reset() {
    setAccount('');
    setDepartment('');
    setOffice('');
    setTag('');
    setQuery('');
    setSelected(null);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GOBIERNO CORPORATIVO DE IA · OBSERVACIÓN</div>
          <h1>Conversaciones y usos de IA</h1>
          <p>
            Solicitudes y respuestas autorizadas, en orden, para mejorar el uso de IA y revisar las
            políticas de seguridad de la empresa.
          </p>
        </div>
        <button className="secondary" onClick={() => setRevision((n) => n + 1)}>
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      <section className="panel conversation-filters" aria-label="Filtros de conversaciones">
        <label>
          Usuario / cuenta
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.department} · {a.office}
              </option>
            ))}
          </select>
        </label>
        <label>
          Departamento
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Todos</option>
            {distinct('department').map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Sucursal
          <select value={office} onChange={(e) => setOffice(e.target.value)}>
            <option value="">Todas</option>
            {distinct('office').map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Etiqueta
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Todas</option>
            {tags.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Agrupar por
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="account">Usuario / cuenta</option>
            <option value="department">Departamento</option>
            <option value="office">Sucursal</option>
            <option value="tag">Etiqueta</option>
          </select>
        </label>
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Buscar en conversaciones"
            placeholder="Buscar en solicitudes y respuestas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="text-button" onClick={reset}>
          Limpiar filtros
        </button>
      </section>
      {error && <div className="error">{error}</div>}
      <div className="conversation-groups">
        {data?.groups.map((g) => (
          <button className="panel conversation-group" key={g.key} onClick={() => chooseGroup(g)}>
            <strong>
              <Users size={16} />
              {g.label}
            </strong>
            <span>
              {count(g.conversations, 'conversación', 'conversaciones')} ·{' '}
              {count(g.turns, 'turno', 'turnos')}
            </span>
            <small>
              {count(g.accounts, 'cuenta', 'cuentas')} ·{' '}
              {count(g.answers, 'respuesta compartida', 'respuestas compartidas')}
            </small>
          </button>
        ))}
      </div>
      <div className="conversation-layout">
        <section className="panel conversation-list">
          <div className="panel-heading">
            <div>
              <h2>Sesiones observadas</h2>
              <p>
                {count(data?.conversations.length || 0, 'conversación', 'conversaciones')} ·{' '}
                {count(data?.totalTurns || 0, 'turno', 'turnos')} {loading ? '· Actualizando…' : ''}
              </p>
            </div>
            <MessageSquare size={21} />
          </div>
          {data?.conversations.map((c) => {
            const a = accounts.find((a) => a.id === c.accountId);
            return (
              <button
                key={c.key}
                className={'conversation-item ' + (c.key === selected ? 'selected' : '')}
                onClick={() => setSelected(c.key)}
              >
                <strong>
                  {a?.label} <ChevronRight size={16} />
                </strong>
                <span>{c.preview}</span>
                <small>
                  {c.provider} · {count(c.turnCount, 'turno', 'turnos')} · {date(c.lastAt)}
                </small>
                <small>
                  {a?.department} · {a?.office}
                </small>
                {(c.hasGaps || c.limited) && <em>Hay límites de captura o permisos</em>}
              </button>
            );
          })}
          {!data?.conversations.length && !loading && (
            <div className="empty compact">
              No hay conversaciones compartidas con estos filtros. Gracias a los colaboradores que
              autorizan sus aportes, aquí podrás identificar usos y recomendaciones.
            </div>
          )}
        </section>
        <section className="panel conversation-thread" aria-label="Detalle de conversación">
          {conversation ? (
            <>
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">{owner?.label}</div>
                  <h2>
                    {conversation.provider}
                    {conversation.model ? ' · ' + conversation.model : ''}
                  </h2>
                  <p>
                    {owner?.department} · {owner?.country} · {owner?.office}
                  </p>
                </div>
                <span className="status neutral">
                  {count(conversation.turnCount, 'turno', 'turnos')}
                </span>
              </div>
              <div className="tags">
                {owner?.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <p className="conversation-source">
                {sources[conversation.sessionSource]} · Sesión {conversation.id.slice(0, 8)}
              </p>
              {(conversation.hasGaps || conversation.limited) && (
                <div className="notice small">
                  <ShieldCheck size={17} />
                  <p>
                    Se muestran los turnos recibidos. Puede faltar historial por permisos,
                    retención, interrupciones o formatos no compatibles. Los fragmentos recortados
                    se indican en cada turno.
                  </p>
                </div>
              )}
              {conversation.turns.map((turn, i) => (
                <article className="conversation-turn" key={turn.id}>
                  <div className="turn-meta">
                    Turno {turn.turnIndex || i + 1} · {date(turn.observedAt)}
                    {turn.upstreamStatus ? ' · HTTP ' + turn.upstreamStatus : ''}
                  </div>
                  <div className="thread-bubble user">
                    <strong>Solicitud · {turn.label}</strong>
                    <pre>{turn.redactedText}</pre>
                    {turn.promptTruncated && <small>Solicitud capturada parcialmente</small>}
                  </div>
                  <div className="thread-bubble assistant">
                    <strong>
                      Respuesta{turn.responseStatus === 'error' ? ' del proveedor · error' : ''}
                    </strong>
                    {turn.redactedResponse !== undefined ? (
                      <pre>{turn.redactedResponse || '(Sin texto)'}</pre>
                    ) : (
                      <p className="muted">{statuses[turn.responseStatus || 'not_authorized']}</p>
                    )}
                    {turn.modelLimited && (
                      <small>
                        El modelo alcanzó su límite de generación; se conserva todo el texto que
                        entregó.
                      </small>
                    )}
                    {turn.redactedResponse !== undefined && turn.responseStatus !== 'complete' && (
                      <small>{statuses[turn.responseStatus || 'unsupported']}</small>
                    )}
                  </div>
                  <div className="detail-privacy">
                    <ShieldCheck size={14} />
                    {turn.redactions + (turn.responseRedactions || 0)} fragmentos redactados ·
                    Información corporativa protegida
                  </div>
                </article>
              ))}
              {nextTurn !== null && (
                <button className="secondary" disabled={detailLoading} onClick={more}>
                  {detailLoading ? 'Cargando…' : 'Cargar siguientes turnos'}
                </button>
              )}
              <p className="conversation-source">
                Mostrando {conversation.turns.length} de {conversation.turnCount} turnos de esta
                lectura.
              </p>
              <details className="conversation-technical">
                <summary>Identificador y continuidad</summary>
                <code>{conversation.id}</code>
                <p>
                  La continuidad se establece con identificadores de sesión o coincidencias exactas
                  del historial. Consultas sin esa evidencia se conservan como sesiones
                  independientes.
                </p>
              </details>
            </>
          ) : (
            <div className="empty large">
              <MessageSquare size={32} />
              <h2>
                {detailLoading ? 'Cargando conversación…' : 'Una conversación, con su contexto'}
              </h2>
              <p>
                Selecciona una sesión para leer las solicitudes y respuestas en orden. Luego compara
                los usos por cuenta, departamento, sucursal o etiqueta.
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="bottom-note">
        <ShieldCheck size={16} />
        Modo de observación: sin bloqueos por contenido. Solo aportes autorizados y redactados.
        Retención vigente: {data?.retention.days || 7} días y hasta{' '}
        {data?.retention.maxTurns || 500} turnos. La redacción no garantiza anonimato.
      </div>
    </>
  );
}
