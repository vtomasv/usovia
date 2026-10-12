import { useEffect, useState } from 'react';
import { Download, Monitor, Laptop, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { detectPlatform, recommendedRelease } from '../../shared/downloads.mjs';
import type { Config, DesktopArtifact } from '../types';
import './desktop-download.css';

type Device = ReturnType<typeof detectPlatform>;
type PlatformHints = {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
};
export function DesktopDownload({
  config,
}: {
  config: Pick<Config, 'downloadUrl' | 'downloadVersion' | 'downloadSha256' | 'desktopReleases'>;
}) {
  const [device, setDevice] = useState<Device>({ os: 'unknown', arch: 'unknown' });
  const [choice, setChoice] = useState<string | null>(null);
  const releases: DesktopArtifact[] =
    config.desktopReleases ||
    (config.downloadUrl
      ? [
          {
            id: 'macos-arm64',
            os: 'macos',
            arch: 'arm64',
            platform: 'macOS Apple Silicon',
            version: config.downloadVersion || '',
            url: config.downloadUrl,
            sha256: config.downloadSha256,
            signed: false,
          },
        ]
      : []);
  useEffect(() => {
    let active = true;
    const hints = (navigator as Navigator & { userAgentData?: PlatformHints }).userAgentData;
    const base = {
      userAgent: navigator.userAgent,
      platform: hints?.platform || navigator.platform,
      mobile: hints?.mobile || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    };
    setDevice(detectPlatform(base));
    hints
      ?.getHighEntropyValues?.(['architecture', 'bitness'])
      .then((extra) => {
        if (active) setDevice(detectPlatform({ ...base, ...extra }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const recommended = recommendedRelease(device, releases);
  const selected = releases.find((r) => r.id === (choice || recommended)) || null;
  const detected =
    device.os === 'macos'
      ? 'macOS detectado'
      : device.os === 'windows'
        ? 'Windows detectado'
        : device.os === 'mobile'
          ? 'Estás usando un dispositivo móvil'
          : device.os === 'linux'
            ? 'Linux detectado'
            : 'Elige tu sistema operativo';
  const incompatible =
    device.os === 'macos' && device.arch === 'x64'
      ? 'Esta edición para Mac requiere Apple Silicon. Todavía no publicamos un paquete para Intel.'
      : device.os === 'windows' && device.arch !== 'x64'
        ? 'El instalador disponible requiere un PC Intel o AMD de 64 bits. Windows ARM no está validado en esta edición.'
        : device.os === 'mobile'
          ? 'Abre esta página en tu computador para instalar Usovia. También puedes consultar aquí los paquetes disponibles.'
          : device.os === 'linux'
            ? 'Esta edición ofrece instaladores para Mac y Windows. Todavía no publicamos una distribución Linux.'
            : null;
  return (
    <div className="desktop-download">
      <div className="dd-detected">
        <Monitor size={16} />
        <span>{detected}</span>
        <span className="dd-local-hint">Detección local</span>
      </div>
      {incompatible && (
        <p className="dd-compatibility" role="status">
          {incompatible}
        </p>
      )}
      <div className="dd-platforms" role="group" aria-label="Seleccionar instalador">
        {(['macos', 'windows'] as const).map((os) => {
          const release = releases.find((r) => r.os === os);
          const Icon = os === 'macos' ? Laptop : Monitor;
          return (
            <button
              key={os}
              type="button"
              disabled={!release}
              aria-pressed={selected?.os === os}
              onClick={() => setChoice(release?.id || null)}
            >
              <Icon size={23} />
              <span>
                <strong>{os === 'macos' ? 'Mac' : 'Windows'}</strong>
                <small>{os === 'macos' ? 'Apple Silicon · .dmg' : 'Intel / AMD · .exe'}</small>
              </span>
              {recommended === release?.id && (
                <span className="dd-recommended">
                  <CheckCircle2 size={12} /> Sugerido
                </span>
              )}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div className="dd-selected">
          <h3>
            Usovia {selected.version} para {selected.os === 'macos' ? 'Mac' : 'Windows'}
          </h3>
          <p>
            {selected.os === 'macos'
              ? 'Para Mac con chip M1 o posterior. Arrastra Usovia a Aplicaciones.'
              : 'Para Windows 10 22H2 / Windows 11 de 64 bits. El asistente instala Usovia en tu cuenta.'}{' '}
            Motor local incluido; descarga tu primer modelo desde la aplicación.
          </p>
          {selected.os === 'macos' && device.os === 'macos' && device.arch === 'unknown' && (
            <p className="dd-compatibility">
              El navegador no informa el chip de tu Mac. Confirma Apple Silicon en  → Acerca de
              este Mac antes de descargar.
            </p>
          )}
          <a className="dd-download-button" href={selected.url}>
            <Download size={18} />
            Descargar para {selected.os === 'macos' ? 'Mac' : 'Windows'}
            <ArrowUpRight size={17} />
          </a>
          <div className="dd-file-meta">
            <span>
              {selected.os === 'macos' ? 'DMG' : 'Instalador EXE'}
              {selected.bytes ? ` · ${Math.round(selected.bytes / 1024 / 1024)} MB` : ''}
            </span>
            <span>Permisos desactivados al comenzar</span>
          </div>
          {!selected.signed && (
            <p className="dd-signing">
              {selected.os === 'macos'
                ? 'Paquete sin firma Developer ID ni notarización.'
                : 'Instalador sin firma Authenticode; Windows puede mostrar una advertencia de editor desconocido.'}{' '}
              Valida su uso con TI y respeta las políticas de tu empresa.
            </p>
          )}
          {selected.os === 'windows' && (
            <p className="dd-coverage">
              Windows incluye chat local, Gemini dentro de Usovia y API/CLI configuradas. Esta
              edición no instala certificados ni modifica el proxy de otros navegadores.
            </p>
          )}
          {selected.sha256 && (
            <details className="dd-integrity">
              <summary>Verificar integridad · SHA-256</summary>
              <code>{selected.sha256}</code>
            </details>
          )}
        </div>
      ) : (
        <p className="dd-compatibility">
          Selecciona el paquete compatible con el computador donde instalarás Usovia.
        </p>
      )}
    </div>
  );
}
