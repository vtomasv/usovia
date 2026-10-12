import { useEffect, useState } from 'react';
import { Search, Users, X, ChevronLeft, ChevronRight, Plus, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import '../analytics.css';
import type { Account } from '../types';
import type { DirectoryData, AccountEntry } from '../analytics-types';
import { formatShortDate } from '../format';
function Directory({
  onSelect,
  onChanged,
  externalRevision = 0,
}: {
  externalRevision?: number;
  onSelect?: (account: AccountEntry) => void;
  onChanged?: () => void;
}) {
  const [query, setQuery] = useState(''),
    [department, setDepartment] = useState(''),
    [page, setPage] = useState(0),
    [data, setData] = useState<DirectoryData | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<DirectoryData>(
        'accounts?' + new URLSearchParams({ query, department, page: String(page) }),
        'GET',
        undefined,
        { signal: abort.signal },
      )
        .then((body) => {
          if (!abort.signal.aborted) {
            setData(body);
            setError('');
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, department, page, revision, externalRevision]);
  async function toggle(a: AccountEntry) {
    try {
      await api('accounts/' + a.id, 'PATCH', { enabled: !a.enabled });
      setRevision((n) => n + 1);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="directory-toolbar">
        <label className="directory-search">
          <Search size={18} />
          <input
            aria-label="Buscar cuentas"
            autoFocus={!!onSelect}
            placeholder="Cuenta, ID, departamento, sucursal o etiqueta"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="directory-department">
          Departamento
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos los departamentos</option>
            {data?.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="directory-count" aria-live="polite">
        {loading ? 'Buscando…' : `${data?.total || 0} cuentas encontradas`}
        <span>Resultados del servidor · 20 por página</span>
      </div>
      <div className="panel table-panel directory-table">
        <table>
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Equipo y sucursal</th>
              <th>Sesiones retenidas</th>
              <th>Último aporte</th>
              <th>{onSelect ? 'Seleccionar' : 'Participación'}</th>
            </tr>
          </thead>
          <tbody>
            {data?.accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.label}</strong>
                  <small className="directory-id">{a.id.slice(0, 8)}</small>
                  <div className="tags">
                    {a.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </td>
                <td>
                  {a.department}
                  <small>
                    {a.country} · {a.office}
                  </small>
                </td>
                <td>
                  <strong>{a.sessions}</strong>
                  <small>{a.turns} turnos compartidos</small>
                </td>
                <td>
                  {formatShortDate(a.lastActivity)}
                  <small>
                    {a.installation?.lastSeen
                      ? `Estado reportado: ${formatShortDate(a.installation.lastSeen)}`
                      : 'Sin reporte de estado'}
                  </small>
                </td>
                <td>
                  {onSelect ? (
                    <button
                      className="directory-select"
                      onClick={() => onSelect(a)}
                      aria-label={'Elegir ' + a.label}
                    >
                      Elegir <ChevronRight size={15} />
                    </button>
                  ) : (
                    <>
                      <button
                        className={'status-button ' + (a.enabled ? 'enabled' : '')}
                        onClick={() => toggle(a)}
                      >
                        {a.enabled ? 'Habilitada' : 'Suspendida'}
                      </button>
                      <small>
                        {a.installation?.consent.capture
                          ? 'Captura autorizada'
                          : a.installation
                            ? 'Captura desactivada'
                            : 'Sin activar'}
                      </small>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !data?.accounts.length && (
          <div className="empty compact">
            No hay cuentas que coincidan. Prueba con un ID, departamento o etiqueta.
          </div>
        )}
      </div>
      <div className="directory-pagination">
        <span>
          Página {page + 1} · {data?.total || 0} cuentas
        </span>
        <button
          className="secondary"
          disabled={page === 0 || loading}
          onClick={() => setPage((n) => n - 1)}
        >
          <ChevronLeft size={15} />
          Anterior
        </button>
        <button
          className="secondary"
          disabled={!data?.hasMore || loading}
          onClick={() => setPage((n) => n + 1)}
        >
          Siguiente
          <ChevronRight size={15} />
        </button>
      </div>
    </>
  );
}
export function AccountPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label?: string;
  onChange: (account: Account | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Account | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return (
    <div className="account-picker">
      <span className="filter-label">Usuario / cuenta</span>
      {value ? (
        <div className="account-selection">
          <Users size={16} />
          <button onClick={() => setOpen(true)}>
            {label || selected?.label || 'Cuenta ' + value.slice(0, 8)}
          </button>
          <button
            aria-label="Quitar filtro de cuenta"
            onClick={() => {
              setSelected(null);
              onChange(null);
            }}
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button className="account-find" onClick={() => setOpen(true)}>
          <Search size={16} />
          Buscar una cuenta
        </button>
      )}
      {open && (
        <div className="overlay directory-overlay">
          <section
            className="dialog directory-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-title"
          >
            <button
              className="icon-button close"
              aria-label="Cerrar búsqueda de cuentas"
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">DIRECTORIO CORPORATIVO</div>
            <h2 id="directory-title">Encuentra una cuenta participante</h2>
            <p className="muted">
              Busca por identidad seudónima y grupos corporativos, sin navegar por una lista
              desplegable.
            </p>
            <Directory
              onSelect={(a) => {
                setSelected(a);
                onChange(a);
                setOpen(false);
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
export function AccountsView({
  onCreate,
  onChanged,
  revision = 0,
}: {
  revision?: number;
  onCreate: () => void;
  onChanged: () => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DIRECTORIO Y PARTICIPACIÓN</div>
          <h1>Cuentas corporativas</h1>
          <p>Encuentra una cuenta, revisa su grupo y consulta sus aportes retenidos.</p>
        </div>
        <button className="primary" onClick={onCreate}>
          <Plus size={17} />
          Crear cuenta
        </button>
      </div>
      <Directory onChanged={onChanged} externalRevision={revision} />
      <div className="bottom-note">
        <ShieldCheck size={16} />
        Las cuentas son seudónimas. Los grupos y el contexto pueden permitir identificar a una
        persona; los conteos no miden productividad.
      </div>
    </>
  );
}
