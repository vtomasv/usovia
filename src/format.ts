export const channelLabels: Record<string, string> = {
  gateway_api: 'API local',
  chat_usovia: 'Chat Usovia',
  aporte_manual: 'Aporte revisado',
  tls_web: 'Web IA · TLS',
  tls_cli: 'CLI · TLS',
  tls_api: 'API cloud · TLS',
  tls_web_fixture: 'HTTPS',
};
export const formatShortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('es-CL', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Sin reporte';
