import { useEffect, useState } from 'react';
import { X, FileDown, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api } from './api';
import type { Filters, SessionSummary, ExportManifest } from './analytics-types';
type Turn = {
  id: string;
  turnIndex: number;
  redactedText: string;
  redactedResponse?: string;
  responseStatus: string;
  promptTruncated?: boolean;
  responseTruncated?: boolean;
  modelLimited?: boolean;
};
type Page = {
  session: SessionSummary;
  version: string;
  turns: Turn[];
  nextAfterTurn: number | null;
};
export function ReviewDialog({
  session,
  onClose,
  onSaved,
}: {
  session: SessionSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null),
    [eventId, setEventId] = useState(''),
    [decision, setDecision] = useState('uncertain'),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    api<Page>('analytics/session?' + new URLSearchParams({ key: session.key }), 'GET', undefined, {
      signal: abort.signal,
    })
      .then((p) => {
        setPage(p);
        setEventId(
          p.turns.find((t) => t.redactedResponse && t.responseStatus === 'complete')?.id || '',
        );
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [session.key]);
  async function more() {
    if (!page || page.nextAfterTurn === null) return;
    setBusy(true);
    try {
      const p = await api<Page>(
        'analytics/session?' +
          new URLSearchParams({
            key: session.key,
            version: page.version,
            afterTurn: String(page.nextAfterTurn),
          }),
      );
      setPage({ ...p, turns: [...page.turns, ...p.turns] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!page) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ saved: boolean; stale: boolean }>('analytics/reviews', 'POST', {
        key: session.key,
        version: page.version,
        eventId,
        decision,
        note,
      });
      if (result.stale) {
        setError('La sesión cambió durante la revisión. Actualiza para evaluar la nueva versión.');
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const complete =
    page &&
    page.turns.length === page.session.turnCount &&
    !page.session.limited &&
    !page.session.hasGaps;
  return (
    <div className="overlay analytics-overlay">
      <section
        className="dialog review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
      >
        <button className="icon-button close" aria-label="Cerrar revisión" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="eyebrow">EVIDENCIA Y REVISIÓN HUMANA</div>
        <h2 id="review-title">Evalúa la utilidad de la sesión</h2>
        <p className="muted">
          {session.account.label} · {session.account.department} · {session.turnCount} turnos
          retenidos
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {!page ? (
          <p>Cargando el contexto…</p>
        ) : (
          <>
            <div className="review-context">
              {page.turns.map((t) => (
                <details className="review-turn" key={t.id} open={page.turns.length <= 3}>
                  <summary>
                    Turno {t.turnIndex} · {t.redactedText.slice(0, 100)}
                  </summary>
                  <pre>{t.redactedText}</pre>
                  <div className="review-answer">
                    <strong>Respuesta capturada</strong>
                    <pre>
                      {t.redactedResponse ?? 'No disponible con los permisos de captura vigentes.'}
                    </pre>
                  </div>
                  <label className="review-choice">
                    <input
                      type="radio"
                      name="reviewed-turn"
                      value={t.id}
                      checked={eventId === t.id}
                      disabled={!t.redactedResponse || t.responseStatus !== 'complete'}
                      onChange={() => setEventId(t.id)}
                    />
                    Usar esta solicitud y respuesta como solución de referencia
                  </label>
                </details>
              ))}
            </div>
            {page.nextAfterTurn !== null && (
              <button className="secondary" disabled={busy} onClick={more}>
                Cargar siguientes turnos
              </button>
            )}
            <div className="analytics-note">
              Contexto leído: {page.turns.length} de {page.session.turnCount} turnos.{' '}
              {page.session.limited || page.session.hasGaps
                ? 'La captura tiene límites: esta sesión no puede validarse como solución completa.'
                : 'Selecciona el turno que fundamenta tu revisión.'}
            </div>
            <div className="review-decisions">
              {[
                ['validated', 'Solución validada'],
                ['rejected', 'Requiere revisión'],
                ['uncertain', 'No concluyente'],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="review-decision"
                    value={value}
                    checked={decision === value}
                    disabled={value === 'validated' && !complete}
                    onChange={() => setDecision(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="review-note">
              Evidencia de utilidad y condiciones de reutilización
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1200}
                placeholder="Qué resolvió, cómo lo verificaste y qué debe revisar quien reutilice este enfoque."
              />
            </label>
            <div className="analytics-note">
              <ShieldCheck size={15} />
              La revisión corresponde a esta versión de la conversación. Un nuevo turno exige
              reevaluarla.
            </div>
            <button
              className="primary full"
              disabled={
                busy ||
                !eventId ||
                note.trim().length < 10 ||
                (decision === 'validated' && !complete)
              }
              onClick={save}
            >
              <CheckCircle2 size={17} />
              {busy ? 'Guardando…' : 'Guardar revisión'}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
export function ExportDialog({ filters, onClose }: { filters: Filters; onClose: () => void }) {
  const [dataset, setDataset] = useState('turns'),
    [includeText, setIncludeText] = useState(false),
    [manifest, setManifest] = useState<ExportManifest | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      setManifest(
        await api<ExportManifest>('analytics/exports', 'POST', { dataset, includeText, filters }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function downloadManifest() {
    if (!manifest) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'usovia-export-manifest.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="overlay analytics-overlay">
      <section
        className="dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <button className="icon-button close" aria-label="Cerrar exportación" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="eyebrow">INTEROPERABILIDAD DE DATOS</div>
        <h2 id="export-title">Exportar a Parquet</h2>
        <p className="muted">
          Archivos Apache Parquet con esquema versionado, fechas nativas y los filtros actuales.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <label>
          Dataset
          <select
            value={dataset}
            onChange={(e) => {
              setDataset(e.target.value);
              setManifest(null);
            }}
          >
            <option value="turns">Turnos · solicitudes y respuestas</option>
            <option value="sessions">Sesiones · contexto y resultados</option>
            <option value="solutions">Soluciones · validadas y candidatas</option>
          </select>
        </label>
        <label className="export-text">
          <input
            type="checkbox"
            checked={includeText}
            onChange={(e) => {
              setIncludeText(e.target.checked);
              setManifest(null);
            }}
          />
          Incluir texto autorizado y redactado
        </label>
        <p className="analytics-note">
          Sin esta opción se exportan únicamente metadatos. Las señales de aceptación se distinguen
          de las soluciones validadas. La redacción no garantiza anonimización.
        </p>
        <button className="primary full" onClick={prepare} disabled={busy}>
          <FileDown size={17} />
          {busy ? 'Preparando archivos…' : 'Preparar exportación'}
        </button>
        {manifest && (
          <div className="export-files">
            <strong>
              {manifest.rowCount} filas · {manifest.parts.length}{' '}
              {manifest.parts.length === 1 ? 'archivo' : 'archivos'}
            </strong>
            <p>
              Enlaces válidos durante 30 minutos. Un borrado invalida la exportación; los cambios
              posteriores pueden retirar filas de una parte.
            </p>
            {manifest.parts.map((part) => (
              <a key={part.index} className="export-part" href={part.url} download={part.filename}>
                <FileDown size={17} />
                <span>
                  {part.filename}
                  <small>{part.rows} filas en el snapshot</small>
                </span>
              </a>
            ))}
            <button className="text-button" onClick={downloadManifest}>
              Descargar manifiesto y esquema de la exportación
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
