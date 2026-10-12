// Only this launcher process receives the local proxy and trust configuration.
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const batchValue = value => {
  if (/[\r\n"\0]/.test(value)) throw new Error('La ruta del lanzador contiene caracteres no admitidos.');
  return value.replaceAll('%', '%%');
};
export function cliLauncher({platform, proxyUrl, caPath, executable, entry}) {
  if (platform === 'win32') return {
    name: 'Gemini con Usovia.cmd',
    content: [
      '@echo off', 'setlocal DisableDelayedExpansion', 'chcp 65001 >nul',
      'rem Proxy exclusivo de esta ventana. No modifica la red ni los certificados de Windows.',
      'set "HTTPS_PROXY=' + batchValue(proxyUrl) + '"',
      'set "HTTP_PROXY=%HTTPS_PROXY%"',
      'set "NODE_EXTRA_CA_CERTS=' + batchValue(caPath) + '"',
      'set "NODE_USE_ENV_PROXY=1"', 'set "ELECTRON_RUN_AS_NODE=1"',
      ...['ALL_PROXY','all_proxy','NO_PROXY','NODE_TLS_REJECT_UNAUTHORIZED','SSLKEYLOGFILE','USOVIA_GEMINI_CMD'].map(key => 'set "' + key + '="'),
      'for /f "delims=" %%G in (\'where gemini.cmd 2^>nul\') do if not defined USOVIA_GEMINI_CMD set "USOVIA_GEMINI_CMD=%%G"',
      'if not defined USOVIA_GEMINI_CMD (echo Instala Gemini CLI con npm install -g @google/gemini-cli. & exit /b 1)',
      'for %%G in ("%USOVIA_GEMINI_CMD%") do set "USOVIA_GEMINI_ENTRY=%%~dpGnode_modules\\@google\\gemini-cli\\dist\\index.js"',
      'if not exist "%USOVIA_GEMINI_ENTRY%" (echo Este lanzador requiere la instalacion global npm de Gemini CLI. & exit /b 1)',
      '"' + batchValue(executable) + '" "' + batchValue(entry) + '" "%USOVIA_GEMINI_ENTRY%" %*',
      'exit /b %errorlevel%', ''
    ].join('\r\n')
  };
  return {name: 'Gemini con Usovia.command', content: [
    '#!/bin/sh', '# Proxy y CA exclusivos de este proceso. Al pausar Usovia, el lanzador deja de conectar.',
    'export HTTPS_PROXY=' + quote(proxyUrl), 'export HTTP_PROXY="$HTTPS_PROXY"',
    'export NODE_EXTRA_CA_CERTS=' + quote(caPath), 'export NODE_USE_ENV_PROXY=1',
    'unset ALL_PROXY all_proxy http_proxy https_proxy NO_PROXY no_proxy NODE_TLS_REJECT_UNAUTHORIZED SSLKEYLOGFILE',
    'export USOVIA_NODE=' + quote(executable), 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'if ! command -v gemini >/dev/null 2>&1; then echo "Instala Gemini CLI para usar este lanzador."; exit 1; fi',
    'GEMINI_ENTRY=$(command -v gemini)', 'export ELECTRON_RUN_AS_NODE=1',
    'exec "$USOVIA_NODE" ' + quote(entry) + ' "$GEMINI_ENTRY" "$@"', ''
  ].join('\n')};
}
