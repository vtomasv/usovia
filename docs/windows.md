# Cliente Windows y distribución por sistema operativo

Usovia 1.2.0 para Windows se distribuye como un instalador NSIS `.exe` para Intel/AMD de 64 bits. Requiere Windows 10 22H2 o Windows 11. Se instala para el usuario actual, sin elevar privilegios. Ofrece un asistente, acceso en Inicio, desinstalador e icono en la bandeja. Cerrar la ventana mantiene la aplicación disponible; «Salir de Usovia» detiene su motor y sus conexiones.

[Descargar el instalador Windows](https://github.com/vtomasv/usovia/releases/download/desktop-v1.2.0-windows-x64/Usovia-1.2.0-windows-x64-setup.exe) · [Release y evidencias](https://github.com/vtomasv/usovia/releases/tag/desktop-v1.2.0-windows-x64) · [Ejecución nativa correcta](https://github.com/vtomasv/usovia/actions/runs/38263761176)

El archivo publicado tiene **129 674 275 bytes** y SHA-256 **c728671ecd83305a37c15fff765817cf3dd9e78dfa4af98fc9c11a011fadb7d0**. Se descargó de la release y se verificaron tanto ese hash como su cabecera PE; el enlace también responde sin autenticación. Mac conserva su distribución 1.1.0 independiente.

## Alcance de esta edición

- Chat local con motor Ollama incluido. Los pesos se descargan desde la aplicación, por separado; sus licencias y requisitos de memoria dependen del modelo. El paquete Windows utiliza CPU: no incluye aceleración NVIDIA, AMD o Vulkan.
- Cuenta de activación y atributos corporativos, permisos separados, pausa, texto redactado, sesiones, respuestas autorizadas, sincronización y recomendaciones del Hub en Vercel.
- Configuración y credenciales locales cifradas mediante `safeStorage` de Electron y DPAPI de Windows. La CA propia se guarda cifrada; se exporta únicamente el certificado público para los procesos configurados.
- Proxy local autenticado para API y CLI compatibles, con política de proveedores descargada de la central. Gemini web utiliza el navegador integrado de Usovia. El lanzador Windows `.cmd` admite la instalación global npm de Gemini CLI y usa el Node incluido en Electron.
- La instalación no añade una CA al almacén de Windows ni cambia WinHTTP, WinINET o el proxy de los navegadores externos. La integración del sistema actualmente pertenece a macOS. Chrome, Edge y Firefox externos no están cubiertos automáticamente por el instalador Windows.

La observación comienza desactivada. Activar una cuenta no autoriza capturar ni compartir conversaciones. El inicio de sesión automático se configura desde la aplicación y no se activa durante la instalación.

La desinstalación conserva el perfil cifrado y los modelos del usuario. Para retirar los aportes del Hub, utiliza el borrado autorizado dentro del cliente antes de desinstalar; eliminar el programa no borra datos ya enviados ni exportaciones descargadas.

## Pipeline reproducible

Ejecutar [Windows installer](../.github/workflows/windows-release.yml) mediante `workflow_dispatch` en la rama deseada. El runner Windows instala dependencias del lockfile, ejecuta la suite, prepara el motor oficial con SHA-256 fijado y construye NSIS. No recibe secretos, cuentas ni datos del Hub de producción.

El runtime proviene del archivo oficial `ollama-windows-amd64.zip` de Ollama **0.40.3**, con SHA-256 **e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5**. Se verifica el archivo completo antes de extraerlo; se conservan el ejecutable, el runner, las DLL compartidas, las variantes CPU y los avisos de licencia, omitiendo directorios de aceleradores opcionales. `runtime-manifest.json` contiene la procedencia y hashes de cada archivo distribuido.

La prueba nativa instala el `.exe`, inicia la aplicación instalada con un perfil temporal sin cuenta ni permisos, comprueba la bandeja, el puente del renderer, el cifrado y persistencia DPAPI, el comportamiento al cerrar la ventana y el arranque del motor. Descarga `qwen2.5:0.5b` y solicita una respuesta real por CPU. Comprueba la salida del motor y ejecuta el desinstalador. Las pruebas del proxy utilizan upstreams TLS sintéticos y verifican redacción, sesiones y pausa sin credenciales de proveedores reales.

Solo si esas comprobaciones pasan, otro job con permiso `contents: write` publica el instalador, `SHA256SUMS.txt`, los manifiestos y `windows-verification.json` en GitHub Releases. El job de compilación conserva `contents: read`. Las acciones oficiales están fijadas a commits. Esta publicación no conecta GitHub con Vercel ni despliega la web automáticamente.

Para compilar localmente en Windows con PowerShell 7 y Node 22:

```powershell
npm ci
$env:RUNNER_TEMP = [IO.Path]::GetTempPath()
./scripts/bundle-runtime-windows.ps1
npm run package:win --workspace @usovia/desktop
./scripts/smoke-windows.ps1
```

Los ejecutables y pesos no se guardan en Git. `shared/release.mjs` conserva las versiones públicas independientes de Mac y Windows; publicar Windows no sustituye el DMG existente. La landing y la consola consumen el mismo componente y el catálogo de `/api/config`.

## Selección de descarga

La detección utiliza pistas del navegador localmente y no las transmite a la central. Identifica Windows/macOS, dispositivos móviles y sistemas sin paquete disponible. Cuando el navegador lo permite, consulta la arquitectura; en Safari no se interpreta `MacIntel` como prueba de CPU Intel porque también se informa así en Apple Silicon. Si falta esa información, el sitio pide confirmar el chip del Mac. No inicia descargas automáticamente, conserva la selección manual y ofrece el hash del archivo elegido.

`DESKTOP_DOWNLOAD_URL` permanece como override del paquete Mac por compatibilidad; no reemplaza el enlace Windows. Si apunta a otro archivo Mac, la API omite el hash anterior para no anunciar un checksum incorrecto.

## Límites de validación

El instalador todavía no tiene firma Authenticode: SmartScreen o las políticas corporativas pueden advertir o impedir su ejecución. No se desactivan esas protecciones. Para distribución empresarial habrá que firmar y validar con TI.

El runner valida Windows x64 con CPU. No sustituye pruebas manuales en equipos de colaboradores, políticas EDR, redes con proxy corporativo, antivirus, Windows ARM ni versiones de CLI distintas de la instalación global npm. Las cuentas de Gemini y su login real dependen del proveedor y requieren validación autorizada en el equipo de destino.

Fuentes: [Ollama en Windows](https://docs.ollama.com/windows), [runtime oficial 0.40.3](https://github.com/ollama/ollama/releases/tag/v0.40.3), [NSIS de electron-builder](https://www.electron.build/v26/docs/nsis/).
