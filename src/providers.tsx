import { useState, useEffect } from 'react';
import { RefreshCw, ShieldCheck, CheckCircle2, Check, Info } from 'lucide-react';
import { api } from './api';
import { formatShortDate as date } from './format';
type ProviderEndpoint = { id: string; url: string; enabled: boolean };
type ProviderPolicy = {
  schemaVersion: number;
  revision: number;
  updatedAt: string | null;
  endpoints: ProviderEndpoint[];
};
export function Providers() {
  const [policy, setPolicy] = useState<ProviderPolicy | null>(null),
    [catalog, setCatalog] = useState<
      {
        id: string;
        label: string;
        provider: string;
        adapter: string;
        channel: string;
        url: string;
      }[]
    >([]),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  async function load() {
    try {
      const result = await api<{ policy: ProviderPolicy; catalog: typeof catalog }>('providers');
      setPolicy(result.policy);
      setCatalog(result.catalog);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  function change(id: string, input: Partial<ProviderEndpoint>) {
    if (policy)
      setPolicy({
        ...policy,
        endpoints: policy.endpoints.map((e) => (e.id === id ? { ...e, ...input } : e)),
      });
    setMessage('');
  }
  async function save() {
    if (!policy) return;
    setSaving(true);
    setError('');
    try {
      const result = await api<{ policy: ProviderPolicy }>('providers', 'PUT', {
        revision: policy.revision,
        endpoints: policy.endpoints,
      });
      setPolicy(result.policy);
      setMessage(
        'Configuración guardada. Los clientes activos consultan cambios cada 30 segundos.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONFIGURACIÓN CENTRAL</div>
          <h1>Proveedores de LLM</h1>
          <p>Define qué rutas de generación puede inspeccionar el proxy del cliente.</p>
        </div>
        <button className="secondary" onClick={load}>
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      <div className="notice">
        <ShieldCheck size={20} />
        <p>
          Solo se aceptan dominios y rutas del catálogo LLM incluido en el cliente. No se admiten
          comodines, URLs con credenciales ni sitios de autenticación. Habilitar un proveedor no
          enciende los permisos del colaborador.
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      {message && (
        <div className="notice">
          <CheckCircle2 size={18} />
          <p>{message}</p>
        </div>
      )}
      {policy && (
        <>
          <section className="panel provider-settings">
            <div className="panel-heading">
              <div>
                <h2>Catálogo de conexiones</h2>
                <p>
                  Política {policy.revision} ·{' '}
                  {policy.updatedAt ? date(policy.updatedAt) : 'Configuración inicial'}
                </p>
              </div>
              <button className="primary" disabled={saving} onClick={save}>
                <Check size={16} />
                {saving ? 'Guardando…' : 'Guardar configuración'}
              </button>
            </div>
            {catalog.map((c) => {
              const e = policy.endpoints.find((e) => e.id === c.id) || {
                id: c.id,
                url: c.url,
                enabled: false,
              };
              return (
                <div className="provider-row" key={c.id}>
                  <label className="provider-check">
                    <input
                      type="checkbox"
                      checked={e.enabled}
                      onChange={(event) => {
                        if (!policy.endpoints.some((x) => x.id === e.id))
                          setPolicy({
                            ...policy,
                            endpoints: [
                              ...policy.endpoints,
                              { ...e, enabled: event.target.checked },
                            ],
                          });
                        else change(e.id, { enabled: event.target.checked });
                      }}
                    />
                    <span>
                      <strong>{c.label}</strong>
                      <small>
                        {c.channel === 'tls_web'
                          ? 'Navegador de Usovia'
                          : c.channel === 'tls_cli'
                            ? 'CLI de Google · autenticación Code Assist'
                            : 'API HTTPS · clientes con proxy'}
                      </small>
                    </span>
                  </label>
                  <input
                    aria-label={'URL ' + c.label}
                    type="url"
                    value={e.url}
                    onChange={(event) => change(e.id, { url: event.target.value })}
                  />
                </div>
              );
            })}
          </section>
          <div className="bottom-note">
            <Info size={16} />
            Gemini permite limitar la ruta a un modelo específico. Las aplicaciones API y CLI deben
            configurar el proxy y la confianza TLS de Usovia. El uso del proveedor requiere una
            cuenta o clave válida. ChatGPT y Claude en el navegador convencional todavía no están
            cubiertos.
          </div>
        </>
      )}
    </>
  );
}
