# Navegadores del equipo — 1.0.1-browser.2

## Estado verificable

La descarga pública 1.0.0 sigue siendo la versión previa. Esta preversión local corrige problemas detectados al probar la ruta de sistema. Chrome se verificó con una respuesta real de Gemini en 1.0.1-browser.1; la corrección 1.0.1-browser.2 requiere otra sesión de validación. Safari sigue pendiente. Se instaló una CA con autorización local durante las pruebas: el PAC ya se restauró y todos los proxies están cerrados, pero la retirada de la CA quedó pendiente del diálogo de macOS.

La batería automatizada comprueba PAC selectivo, separación de listeners, validación TLS, rechazo de dominios ajenos al catálogo, política central, pausa, diario de configuración y restauración de valores sin sobrescribir cambios ajenos. El ayudante Swift está compilado en arm64 y usa frameworks propios de macOS; el usuario final no necesita instalar Swift, Python ni mitmproxy. Los tests del ayudante prueban transformaciones y controles; todavía no ejercitan escritura real en el llavero ni preferencias del sistema.

| Navegador / canal | Mecanismo | Estado de la preversión |
| --- | --- | --- |
| Chrome convencional | PAC de macOS + CA en System.keychain | Ruta verificada en 1.0.1-browser.1; corrección 1.0.1-browser.2 pendiente |
| Safari | PAC de macOS + CA en System.keychain | Implementado; prueba real pendiente |
| Edge, Brave, Opera, Vivaldi | PAC del sistema y confianza local, según configuración | Compatibilidad prevista, sin validar ni instalar esos navegadores |
| Firefox | Usar proxy del sistema + confianza en raíces del sistema | Compatibilidad prevista; un perfil con opciones propias requiere configuración adicional |
| Navegador de Usovia | Proxy autenticado + verificador CA restringido a hosts habilitados | Verificado previamente con respuesta real de Gemini |
| CLI / SDK | Variables de proxy y CA propias del proceso | Se conserva el canal existente; la CA del sistema no configura todos los runtimes |

"Navegador" y "proveedor web" son dos ejes diferentes. Cualquier navegador que respete la configuración puede enviar Gemini por esta ruta. El catálogo actual incluye un adaptador de conversación web para **Gemini** y adaptadores **API** de ocho proveedores. Las interfaces web de ChatGPT, Claude y otros necesitan adaptadores adicionales. No se anuncian como mensajes clasificables por el mero hecho de instalar una CA.

## Activación del participante

1. Abrir el cliente de preversión, activar una cuenta y autorizar `capture`. El permiso de compartir texto y el de reportar estado siguen siendo independientes. Para la primera comprobación se puede dejar el envío de texto desactivado.
2. Ir a **Proveedores y conexiones → Autorizar navegadores del equipo**. La aplicación explica la ampliación de confianza TLS y abre el activador en Terminal.
3. Revisar huella SHA-256 y dominios. Escribir `ACTIVAR` y autenticar `sudo` localmente; nunca enviar la contraseña por chat. El manifiesto tiene vigencia de diez minutos. Mantener la ventana del ayudante abierta durante la sesión.
4. El cliente distingue configuración solicitada, PAC configurado y PAC efectivo en la red actual. El indicador de sistema no demuestra que todos los perfiles de navegador estén usando esa configuración.
5. Probar una consulta sintética en una sesión nueva de Chrome y luego Safari. No usar historiales ni conversaciones reales para comprobar el demo. Recargar o reiniciar el navegador si conserva conexiones anteriores.
6. Pausar captura. Se cierran los sockets inspeccionados inmediatamente. En el siguiente tick del ayudante se restaura el PAC anterior y se solicita retirar la CA del sistema. macOS puede solicitar autorización administrativa adicional; hasta completarla, la CA puede seguir instalada aunque el proxy esté detenido. Verificar navegación directa, ausencia de nuevos aportes y retiro del certificado.

La autorización del ayudante dura la sesión de Usovia; no se instala un servicio de arranque privilegiado. Esta interfaz de Terminal es provisional. Una distribución comercial necesita ayudante firmado, autorización nativa, firma y notarización antes de reemplazar este mecanismo.

## Ruta selectiva y confianza

- `127.0.0.1:11440`: proxy API/CLI con autenticación; conserva el comportamiento anterior.
- `127.0.0.1:11442`: listener exclusivo de navegadores, habilitado solo después de la solicitud local y mientras exista consentimiento de captura y política vigente. No necesita credenciales porque PAC no puede suministrarlas; rechaza CONNECT hacia dominios ajenos a los LLM habilitados y no actúa como proxy general. Otros procesos del mismo usuario pueden acceder a este listener: no es autenticación de identidad de navegador ni una frontera frente a malware local.
- `127.0.0.1:11441/<sesión>/proxy.pac?revision=<n>`: PAC local sin credenciales. Solo HTTPS hacia hosts exactos de la política usa `PROXY 127.0.0.1:11442; DIRECT`; lo demás usa `DIRECT`. No incluye comodines, seguimiento de URLs ni resolución DNS dentro del PAC. Se cambia la URL al cambiar la revisión para invalidar la caché de PAC del navegador.
- La central puede habilitar únicamente dominios y rutas ya reconocidos por el catálogo del cliente. No puede activar consentimiento ni instalar la CA por sí sola.
- El PAC decide por **dominio**, no por ruta HTTPS; Chrome elimina las rutas antes de evaluar el PAC. En un dominio elegido se descifra TLS para reconocer la ruta; únicamente se extraen consultas humanas de rutas y formatos admitidos. Las demás rutas se reenvían sin analizar su texto. Las respuestas no se almacenan y las cabeceras no se usan como telemetría. Es preciso interpretar "solo LLM" con ese alcance.
- La CA es única por instalación; su clave privada sigue cifrada en el almacén del usuario. El ayudante privilegiado recibe solo DER público y huella. Se instala confianza **TLS** en el llavero del sistema; ese alcance de confianza no queda criptográficamente restringido a los dominios del PAC. El proxy sí restringe los dominios y valida siempre el certificado original del proveedor.

## Restauración y fallos

El ayudante conserva los valores originales del protocolo de proxies por ID de servicio en un diario root `0600` bajo `/Library/Application Support/Usovia/BrowserSessions/<sesión>/`. Guarda el estado antes de modificar confianza o PAC. Solo altera dos claves de PAC. Si se cambian otros ajustes durante la sesión, los conserva al restaurar; si alguien reemplaza el PAC por uno distinto, no lo sobrescribe. Los servicios que ya tengan PAC, WPAD o proxy manual activo quedan intactos y se enumeran como no cubiertos. Se comprobó que este Mac tiene un proxy previo en el adaptador USB: no se sustituye.

Un lease local se actualiza cada dos segundos. Si Usovia termina, cierra el lease o deja de actualizarlo durante doce segundos, el ayudante intenta retirar la CA y restaurar la red. Al salir normalmente, Usovia solicita restauración y espera brevemente al ayudante. El PAC incluye conexión directa como fallback: si el proxy cae, el tráfico puede continuar sin clasificar. Por tanto esta herramienta mide y recomienda; **no garantiza observación exhaustiva ni bloqueo DLP**.

Si se mata el ayudante con SIGKILL, se apaga el equipo en medio de la operación o el llavero rechaza retirar la CA, pueden quedar ajustes pendientes. Usar **Recuperar ajustes tras un cierre forzado**, que abre la recuperación con `sudo`. Solo recupera sesiones pendientes del mismo usuario y no toca las que tienen un ayudante y lease vivos. Verificar el llavero y preferencias tras esa recuperación. La CA puede permanecer después de un apagado abrupto hasta completar la recuperación; no se promete limpieza automática al arrancar.

Si se crea otro servicio de red mientras el ayudante está activo, hay que desactivar y volver a activar la integración para incluirlo. VPN, perfiles MDM, extensiones, proxy propio del navegador, almacén CA independiente, WSS, HTTP/2 exclusivo, gRPC, HTTP/3/QUIC directo y pinning requieren pruebas o mecanismos adicionales. El PAC enruta HTTPS TCP de los navegadores compatibles; no es un filtro de paquetes ni fuerza a procesos que omitan el proxy. Windows y Linux necesitan integración propia; este paquete es macOS arm64.

## Criterio para cerrar la prueba

- Chrome y Safari envían una consulta sintética a Gemini; se observa respuesta completa y clasificación local del prompt. Si el participante habilita texto, se verifica ese único aporte redactado en el Hub.
- Un sitio no LLM conserva su certificado y no pasa por el listener de navegación. Autenticación de Google tampoco se dirige al proxy.
- Deshabilitar Gemini en la central cambia la revisión/PAC y corta conexiones inspeccionadas. Los permisos no cambian.
- Pausar restaura los valores anteriores, retira la CA y no recibe nuevas consultas. Reanudar usa nuevamente autorización vigente del participante.
- Salida, fallo de Usovia y recuperación del ayudante se verifican en un Mac de prueba con copias de los ajustes, sin conversaciones personales.
- Antes de publicar: comprobar la firma y el contenido del instalador; completar esta matriz y registrar evidencias. La prueba real pendiente no se sustituye por tests de fixtures.

Referencias primarias: [proxy y PAC de Chromium](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md), [confianza local de Chrome](https://chromium.googlesource.com/chromium/src/+/HEAD/net/data/ssl/chrome_root_store/faq.md), [CA del sistema en Firefox](https://support.mozilla.org/en-US/kb/setting-certificate-authorities-firefox), [SCPreferences de Apple](https://developer.apple.com/documentation/systemconfiguration/scpreferences-ft8).

## Hallazgos de la prueba real del 12 de octubre de 2026

Chrome convencional completó una conversación temporal con Gemini usando el PAC efectivo de macOS y la CA local. La respuesta terminó correctamente. El Hub recibió el marcador sintético `USOVIA_QA_CHROME_20261012`, canal `tls_web`, HTTP 200 y categoría «Aprendizaje e investigación». Hubo dos generaciones: el modo Pro comenzó a pensar y se pulsó «Answer now», por lo que ambas solicitudes aparecen como eventos independientes. La evidencia de la respuesta está en `.runtime/browser-system/evidence/chrome-gemini.png`.

`/usr/bin/curl` verificó la conexión por el listener de navegador con HTTP 200 y `ssl_verify_result=0`, usando la confianza del sistema sin una excepción TLS. Gemini CLI, con Node incluido en el cliente y una clave deliberadamente inválida, completó TLS y generó un evento nuevo identificado; terminó en HTTP 400 por credencial inválida. Esto no demuestra respuesta autenticada de un modelo por CLI. Las API de OpenAI, Anthropic, Gemini y Code Assist completaron TLS y devolvieron HTTP 401 al recibir las credenciales de prueba. Los demás proveedores siguen fuera de la prueba de interceptación hasta autorización explícita de su habilitación; pueden comprobarse por túneles TLS íntegros sin ampliar la política.

El caso real descubrió dos problemas del ayudante. Un descriptor de archivo de lease abierto puede tener cero enlaces después de su reemplazo atómico; rechazarlo invalida una renovación legítima. Se añadió una regresión determinista que reemplaza el archivo entre `open` y `fstat` y comprueba la lectura del descriptor anterior y del archivo renovado. Además, el comando de retirada de confianza puede esperar en SecurityAgent mientras el estado del ayudante envejece. La corrección mantiene un estado explícito `installing_root` / `removing_root`, libera el bloqueo de preferencias de red antes de esperar a una autorización y comprueba que la red no cambió durante esa espera antes de aplicar PAC. La corrección debe volver a validarse en la sesión real; no se considera cerrada por compilar o pasar tests.

El PAC de la sesión inicial se restauró, pero la retirada de la CA quedó pendiente de autorización de macOS. No se presenta como restauración completa hasta verificar tanto el diario como la ausencia de certificado y confianza. Las [reglas de Apple para el dominio de confianza administrativa](https://github.com/apple-oss-distributions/Security/blob/main/OSX/authd/authorization.plist) requieren entitlement o autenticación de administrador. No se altera esa política ni se promete que una firma de desarrollador elimine por sí sola las solicitudes de autorización.

El control automático de Safari fue bloqueado porque no existe un selector disponible que limite el acceso a la ventana privada autorizada. Su prueba se completa manualmente con el participante y se contrasta con el evento del Hub; no se cuenta como validada si el proxy no estaba activo. La revisión automática también rechazó ampliar toda la política central sin aprobación específica. La política original se conserva en esa etapa.
