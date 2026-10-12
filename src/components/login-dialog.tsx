import { useEffect, type FormEvent } from 'react';
import { ArrowRight, KeyRound, X } from 'lucide-react';

type Props = {
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  error: string;
  busy: boolean;
};

export function LoginDialog({ password, onPasswordChange, onSubmit, onClose, error, busy }: Props) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="overlay">
      <form
        className="dialog login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onSubmit={onSubmit}
      >
        <button type="button" className="icon-button close" aria-label="Cerrar" onClick={onClose}>
          <X size={20} />
        </button>
        <KeyRound className="dialog-icon" />
        <div className="eyebrow">ACCESO ADMINISTRATIVO</div>
        <h2 id="login-title">Entra a tu espacio</h2>
        <p className="muted">La consola contiene aportes y permisos de cuentas participantes.</p>
        <label>
          Contraseña del Hub
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary full" disabled={busy}>
          {busy ? 'Conectando…' : 'Entrar a Usovia Hub'}
          <ArrowRight size={17} />
        </button>
      </form>
    </div>
  );
}
