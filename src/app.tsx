import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  LayoutDashboard,
  Users,
  Activity,
  Sparkles,
  Download,
  Plus,
  Check,
  ShieldCheck,
  Copy,
  X,
  LogOut,
  ChevronRight,
  Monitor,
  Globe,
  CheckCircle2,
  Info,
  BarChart3,
} from 'lucide-react';
import { Landing } from './landing';
import { api } from './api';
import { formatShortDate as date } from './format';
import { Logo } from './components/brand';
import { EventsTable } from './components/events-table';
import { LoginDialog } from './components/login-dialog';
import type { Account, UsageEvent, Overview, Config } from './types';
const Conversations = lazy(() =>
  import('./conversations').then((view) => ({ default: view.Conversations })),
);
const Providers = lazy(() => import('./providers').then((view) => ({ default: view.Providers })));
const AnalyticsDashboard = lazy(() =>
  import('./analytics').then((view) => ({ default: view.AnalyticsDashboard })),
);
const AccountsView = lazy(() =>
  import('./components/account-directory').then((view) => ({ default: view.AccountsView })),
);
const viewFallback = (
  <div className="panel empty" role="status">
    Abriendo la vista…
  </div>
);
const empty: Overview = {
  accounts: [],
  installations: [],
  events: [],
  tasks: [],
  opportunities: [],
  totals: { accounts: 0, events: 0, redactions: 0 },
};
const nav = [
  { id: 'analytics', label: 'Inteligencia de uso', icon: BarChart3 },
  { id: 'overview', label: 'Resumen operativo', icon: LayoutDashboard },
  { id: 'accounts', label: 'Cuentas', icon: Users },
  { id: 'events', label: 'Conversaciones', icon: Activity },
  { id: 'opportunities', label: 'Oportunidades', icon: Sparkles },
  { id: 'providers', label: 'Proveedores LLM', icon: Globe },
  { id: 'install', label: 'Instalar cliente', icon: Download },
];
export function App() {
  const [authenticated, setAuthenticated] = useState(false),
    [ready, setReady] = useState(false),
    [login, setLogin] = useState(false),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('analytics'),
    [data, setData] = useState<Overview>(empty),
    [config, setConfig] = useState<Config>({
      organization: 'Gobierno corporativo de IA',
      downloadUrl: null,
      hubUrl: null,
    }),
    [modal, setModal] = useState(false),
    [activation, setActivation] = useState<{ activationCode: string; account: Account } | null>(
      null,
    ),
    [detail, setDetail] = useState<UsageEvent | null>(null),
    [initialConversation, setInitialConversation] = useState<string | undefined>(undefined),
    [copied, setCopied] = useState(false),
    [form, setForm] = useState({ department: '', country: 'Chile', office: '', tags: '' });
  useEffect(() => {
    Promise.all([
      api<{ authenticated: boolean }>('session').then((d) => setAuthenticated(d.authenticated)),
      api<Config>('config').then(setConfig),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  async function refresh() {
    try {
      setData(await api<Overview>('overview'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (authenticated && ['overview', 'accounts', 'opportunities'].includes(tab)) {
      refresh();
      const timer = setInterval(refresh, 10000);
      return () => clearInterval(timer);
    }
  }, [authenticated, tab]);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('login', 'POST', { password });
      setPassword('');
      setAuthenticated(true);
      setLogin(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ activationCode: string; account: Account }>('accounts', 'POST', {
        ...form,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setActivation(result);
      await refresh();
      setForm({ department: '', country: 'Chile', office: '', tags: '' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('No se pudo copiar. Selecciona y copia el texto manualmente.');
    }
  }
  const connected = data.installations.filter((i) => i.reachable).length;
  const participating = data.installations.filter((i) => i.consent.capture).length;
  const maxTask = Math.max(1, ...data.tasks.map((t) => t.count));
  const accountFor = (id: string) => data.accounts.find((a) => a.id === id);
  if (!ready)
    return (
      <div className="loading">
        <img src="/mark.svg" alt="" />
        <span>Abriendo Usovia…</span>
      </div>
    );
  if (!authenticated)
    return (
      <div>
        <Landing config={config} onLogin={() => setLogin(true)} />
        {login && (
          <LoginDialog
            password={password}
            onPasswordChange={setPassword}
            onSubmit={signIn}
            onClose={() => setLogin(false)}
            error={error}
            busy={busy}
          />
        )}
      </div>
    );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        <div className="workspace">
          <span className="workspace-icon">U</span>
          <div>
            <strong>{config.organization}</strong>
            <small>Central de Usovia</small>
          </div>
        </div>
        <div className="nav-label">TU ESPACIO</div>
        <nav>
          {nav.map((item) => (
            <button
              className={tab === item.id ? 'selected' : ''}
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setInitialConversation(undefined);
              }}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === 'opportunities' && data.opportunities.length > 0 && (
                <span className="nav-count">{data.opportunities.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <strong>El control está en el desktop</strong>
            <p>Los permisos del participante definen qué puede recibir este espacio.</p>
          </div>
          <button
            className="logout"
            onClick={async () => {
              await api('logout', 'POST');
              setAuthenticated(false);
            }}
          >
            <LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Usovia Hub <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="pilot-badge">OBSERVACIÓN</span>
            <span className="avatar">U</span>
          </div>
        </header>
        <main className="dashboard">
          {error && (
            <div className="error dismissible">
              {error}
              <button className="icon-button" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          <div hidden={tab !== 'analytics'}>
            <Suspense fallback={viewFallback}>
              <AnalyticsDashboard
                active={tab === 'analytics'}
                onOpenConversation={(key) => {
                  setInitialConversation(key);
                  setTab('events');
                }}
              />
            </Suspense>
          </div>
          {tab === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PANORAMA DE PARTICIPACIÓN</div>
                  <h1>Aprender del uso. Mejorar juntos.</h1>
                  <p>
                    Gobierno de IA y políticas de seguridad con aportes autorizados. Gracias a cada
                    colaborador por su participación.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setModal(true);
                    setActivation(null);
                  }}
                >
                  <Plus size={17} />
                  Crear cuenta
                </button>
              </div>
              <div className="metric-grid">
                {[
                  {
                    icon: Users,
                    label: 'Cuentas habilitadas',
                    value: data.accounts.filter((a) => a.enabled).length,
                    sub: 'Sin nombres ni correos',
                  },
                  {
                    icon: Monitor,
                    label: 'Conexiones recientes',
                    value: connected,
                    sub: 'Reporte recibido en los últimos 90 s',
                  },
                  {
                    icon: Activity,
                    label: 'Aportes compartidos',
                    value: data.totals.events,
                    sub: 'Texto preparado con redacción',
                  },
                  {
                    icon: Sparkles,
                    label: 'Oportunidades candidatas',
                    value: data.opportunities.length,
                    sub: 'Patrones para validar con el negocio',
                  },
                ].map((m) => (
                  <div className="metric" key={m.label}>
                    <div className="metric-label">
                      {m.label}
                      <m.icon size={17} />
                    </div>
                    <strong>{m.value.toLocaleString('es-CL')}</strong>
                    <small>{m.sub}</small>
                  </div>
                ))}
              </div>
              <div className="panel-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>¿Para qué se está usando IA?</h2>
                      <p>Tareas identificadas en los aportes recibidos.</p>
                    </div>
                    <span className="soft-badge">REGLAS EXPLICABLES</span>
                  </div>
                  {data.tasks.length ? (
                    <div className="task-list">
                      {data.tasks.map((t) => (
                        <div className="task-row" key={t.id}>
                          <div>
                            <span>{t.label}</span>
                            <strong>{t.count}</strong>
                          </div>
                          <div className="bar">
                            <span style={{ width: `${(t.count / maxTask) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">
                      <Activity size={27} />
                      <h3>El primer aporte abre el panorama</h3>
                      <p>Activa una cuenta en el desktop y comparte una consulta redactada.</p>
                      <button className="text-button" onClick={() => setTab('install')}>
                        Ver cómo comenzar <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel participation-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Participación con control</h2>
                      <p>Permisos reportados por cada instalación.</p>
                    </div>
                    <ShieldCheck size={22} />
                  </div>
                  <div className="participation-value">
                    <strong>{participating}</strong>
                    <span>instalaciones con captura autorizada</span>
                  </div>
                  <div className="consent-stat">
                    <span className="green-dot" />
                    Comparten texto redactado
                    <strong>{data.installations.filter((i) => i.consent.shareText).length}</strong>
                  </div>
                  <div className="consent-stat">
                    <span className="gray-dot" />
                    Solo reportan estado
                    <strong>
                      {
                        data.installations.filter(
                          (i) => !i.consent.capture && i.consent.reportStatus,
                        ).length
                      }
                    </strong>
                  </div>
                  <div className="note">
                    Un permiso reportado no demuestra conexión actual. El estado tiene fecha y puede
                    quedar desactualizado.
                  </div>
                </section>
              </div>
              <section className="panel latest">
                <div className="panel-heading">
                  <div>
                    <h2>Aportes recientes</h2>
                    <p>Consultas compartidas con autorización específica.</p>
                  </div>
                  <button className="text-button" onClick={() => setTab('events')}>
                    Ver todos <ArrowUpRight size={16} />
                  </button>
                </div>
                {data.events.length ? (
                  <EventsTable
                    events={data.events.slice(0, 5)}
                    accountFor={accountFor}
                    onSelect={setDetail}
                  />
                ) : (
                  <div className="empty compact">
                    Todavía no hay consultas compartidas. Gracias por colaborar con el gobierno
                    corporativo de IA.
                  </div>
                )}
              </section>
              <div className="bottom-note">
                <Info size={16} />
                Este panorama describe la muestra voluntaria recibida. No mide productividad ni todo
                el uso de IA de la empresa.
              </div>
            </>
          )}
          {tab === 'accounts' && (
            <Suspense fallback={viewFallback}>
              <AccountsView
                revision={data?.accounts.length || 0}
                onCreate={() => {
                  setModal(true);
                  setActivation(null);
                }}
                onChanged={refresh}
              />
            </Suspense>
          )}
          {tab === 'events' && (
            <Suspense fallback={viewFallback}>
              <Conversations initialConversation={initialConversation} />
            </Suspense>
          )}
          {tab === 'opportunities' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">USOVIA RADAR</div>
                  <h1>Del uso a una oportunidad</h1>
                  <p>Tareas recurrentes que merecen una conversación y un experimento.</p>
                </div>
                <span className="soft-badge">HIPÓTESIS · REVISIÓN HUMANA</span>
              </div>
              {data.opportunities.length ? (
                <div className="opportunity-grid">
                  {data.opportunities.map((o) => (
                    <article className="opportunity" key={o.id}>
                      <div className="opportunity-icon">
                        <Sparkles size={23} />
                      </div>
                      <span className="status neutral">{o.stage}</span>
                      <h2>{o.title}</h2>
                      <p>{o.description}</p>
                      <div className="opportunity-footer">
                        <span>{o.task}</span>
                        <strong>{o.count} aportes</strong>
                      </div>
                      <div className="next-step">
                        <CheckCircle2 size={16} />
                        Próximo paso: validar una tarea con su responsable.
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className="panel">
                  <div className="empty large">
                    <Sparkles size={32} />
                    <h2>Las oportunidades nacen de patrones</h2>
                    <p>
                      Al recibir tres o más aportes de una tarea, Usovia propondrá una hipótesis
                      para evaluar. La repetición no demuestra ahorro ni valor comercial.
                    </p>
                  </div>
                </section>
              )}
            </>
          )}
          {tab === 'providers' && (
            <Suspense fallback={viewFallback}>
              <Providers />
            </Suspense>
          )}
          {tab === 'install' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">COMIENZA EN EL DESKTOP</div>
                  <h1>De la cuenta a la primera mejora</h1>
                  <p>
                    Activa tu cuenta, revisa las políticas de seguridad de tu empresa y elige tus
                    permisos de participación.
                  </p>
                </div>
                <Monitor size={34} />
              </div>
              <div className="install-layout">
                <section className="panel install-card">
                  <img src="/mark.svg" alt="" />
                  <h2>Usovia para macOS</h2>
                  <p>
                    Cliente para Apple Silicon, con motor local incluido y permisos de participación
                    desactivados al comenzar.
                  </p>
                  {config.downloadUrl ? (
                    <a className="primary" href={config.downloadUrl}>
                      <Download size={17} />
                      Descargar Usovia {config.downloadVersion}
                    </a>
                  ) : (
                    <div className="notice small">
                      <Info size={18} />
                      <p>
                        El paquete del cliente se prepara por separado. El administrador debe
                        configurar su enlace de descarga para habilitar este botón.
                      </p>
                    </div>
                  )}
                  <small>
                    Paquete sin notarización. Instala únicamente desde la fuente acordada con el
                    administrador de tu empresa.
                  </small>
                  <div className="hub-address">
                    <span>Servidor para activar la cuenta</span>
                    <code>{config.hubUrl || window.location.origin}</code>
                    <button
                      className="icon-button"
                      aria-label="Copiar URL del Hub"
                      onClick={() => copy(config.hubUrl || window.location.origin)}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                </section>
                <section className="panel steps-card">
                  {[
                    [
                      '01',
                      'Crea y entrega una cuenta',
                      'Genera un ID de activación y asigna atributos de grupo. No necesitas nombre ni correo.',
                    ],
                    [
                      '02',
                      'Activa y elige permisos',
                      'En el cliente, introduce la URL de este Hub y el ID. Autoriza los canales y el envío de texto redactado.',
                    ],
                    [
                      '03',
                      'Comienza a usar IA',
                      'Abre Gemini desde Usovia, crea el lanzador de Gemini CLI o consulta un modelo local. Revisa aportes y sugerencias en el Hub.',
                    ],
                    [
                      '04',
                      'Pausa y verifica',
                      'Detén captura y aportes. Comprueba que no lleguen nuevas consultas y que el estado refleje los permisos reportados.',
                    ],
                  ].map(([n, h, p]) => (
                    <div className="install-step" key={n}>
                      <span>{n}</span>
                      <div>
                        <h3>{h}</h3>
                        <p>{p}</p>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
              <div className="notice">
                <ShieldCheck size={20} />
                <p>
                  <strong>Cobertura del cliente publicado:</strong> chat y API local, Gemini en el
                  navegador de Usovia y API/CLI configuradas con su proxy TLS. Los proveedores y
                  rutas de generación se habilitan en la central. Los navegadores que usan proxy y
                  certificados de macOS pueden integrarse con autorización local en el cliente 1.1.
                  La captura web está disponible para Gemini; ChatGPT y Claude web requieren
                  adaptadores adicionales.
                </p>
              </div>
            </>
          )}
        </main>
      </div>
      {modal && (
        <div className="overlay">
          <div className="dialog">
            <button
              className="icon-button close"
              aria-label="Cerrar"
              onClick={() => {
                setModal(false);
                setActivation(null);
              }}
            >
              <X size={20} />
            </button>
            {activation ? (
              <>
                <div className="success-icon">
                  <CheckCircle2 size={30} />
                </div>
                <div className="eyebrow">CUENTA PREPARADA</div>
                <h2>{activation.account.label} ya puede activarse</h2>
                <p className="muted">
                  Entrega el código por un canal privado. Expira en 24 horas y solo puede utilizarse
                  una vez.
                </p>
                <div className="activation-code">
                  <code>{activation.activationCode}</code>
                  <button
                    className="icon-button"
                    aria-label="Copiar ID"
                    onClick={() => copy(activation.activationCode)}
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
                <div className="notice small">
                  <Info size={18} />
                  <p>
                    El código se muestra una sola vez. Crear la cuenta no autoriza captura ni envío
                    de datos.
                  </p>
                </div>
                <button
                  className="primary full"
                  onClick={() => {
                    setModal(false);
                    setActivation(null);
                  }}
                >
                  Listo <Check size={17} />
                </button>
              </>
            ) : (
              <form onSubmit={createAccount}>
                <div className="eyebrow">PARTICIPACIÓN SIN NOMBRES</div>
                <h2>Crea una cuenta</h2>
                <p className="muted">
                  Agrupa la cuenta con atributos genéricos. Estos datos no garantizan anonimato.
                </p>
                <label>
                  Departamento
                  <input
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    placeholder="Ej. Operaciones"
                    required
                    maxLength={100}
                  />
                </label>
                <div className="form-row">
                  <label>
                    País
                    <input
                      value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value })}
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Sucursal
                    <input
                      value={form.office}
                      onChange={(e) => setForm({ ...form, office: e.target.value })}
                      placeholder="Ej. Santiago"
                      maxLength={100}
                    />
                  </label>
                </div>
                <label>
                  Etiquetas
                  <input
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    placeholder="atención al cliente, operaciones"
                    maxLength={280}
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  {busy ? 'Creando…' : 'Crear ID de activación'}
                  <ArrowRight size={17} />
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      {detail && (
        <div className="overlay detail-overlay" onClick={() => setDetail(null)}>
          <section className="detail-panel" onClick={(e) => e.stopPropagation()}>
            <button
              className="icon-button close"
              aria-label="Cerrar"
              onClick={() => setDetail(null)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">APORTE AUTORIZADO</div>
            <h2>{detail.label}</h2>
            <div className="detail-meta">
              <span>{accountFor(detail.accountId)?.label}</span>
              <span>{date(detail.receivedAt)}</span>
              <span>
                {detail.provider} {detail.model}
              </span>
            </div>
            {detail.upstreamStatus && (
              <div className="notice small">
                <Info size={17} />
                <p>
                  Respuesta HTTP reportada por el cliente: <strong>{detail.upstreamStatus}</strong>.{' '}
                  {detail.upstreamStatus >= 400
                    ? 'La solicitud se observó, pero el proveedor devolvió un error. No demuestra una respuesta del modelo.'
                    : 'El estado HTTP describe el transporte; no evalúa la calidad de la respuesta.'}
                </p>
              </div>
            )}
            <h3>Solicitud compartida</h3>
            <pre className="redacted-text">{detail.redactedText}</pre>
            <h3>Respuesta compartida</h3>
            {detail.redactedResponse !== undefined ? (
              <pre className="redacted-text">{detail.redactedResponse}</pre>
            ) : (
              <p className="muted">
                No hay respuesta compartida para este aporte. Revisa los permisos y la cobertura del
                cliente.
              </p>
            )}
            <div className="detail-privacy">
              <ShieldCheck size={16} />
              {detail.redactions} fragmentos redactados · No es garantía de anonimato
            </div>
            <h3>Cómo mejorar esta consulta</h3>
            {detail.tips.map((t) => (
              <div className="recommendation" key={t.id}>
                <Sparkles size={18} />
                <div>
                  <strong>{t.title}</strong>
                  <p>{t.detail}</p>
                  <pre>{t.example}</pre>
                </div>
              </div>
            ))}
            <div className="bottom-note">
              Sugerencias orientativas generadas por reglas explicables.
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
