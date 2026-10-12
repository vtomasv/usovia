# Usovia 1.1: cliente y conversaciones de IA corporativa

Esta versión introduce una interfaz de colaboración con las políticas de seguridad de la empresa, control desde la barra de menús y conversaciones con solicitudes y respuestas redactadas. El tratamiento de contenido opera en modo de observación. No hay bloqueo DLP de solicitudes por contener credenciales; la autenticación de las API, la verificación TLS y los límites de transporte se conservan.

## Cliente

- Cerrar la ventana la oculta y mantiene el proceso y su icono activos. El menú muestra el estado de observación y envío, permite abrir la ventana, revisar permisos, pausar y salir.
- Abrir al iniciar sesión es opcional y utiliza los ajustes de inicio de sesión de Electron. No concede permisos nuevos.
- El chat local reenvía hasta 20 mensajes previos y usa una ventana de 2.048 tokens del modelo. Conserva el historial visible en memoria durante la sesión y permite iniciar una conversación nueva. Ese historial no se escribe en el disco como texto original. Los aportes autorizados pendientes se almacenan cifrados por el sistema operativo.
- Se retiran los activadores de Terminal del flujo de integración del navegador. El cliente muestra el alcance y el ayudante solicita autorización gráfica mediante Authorization Services. El ayudante recibe únicamente un manifiesto con CA pública, huella, UID, PID y PAC local; nunca la clave privada TLS ni credenciales de proveedores.
- El proceso privilegiado es de sesión. La caducidad de su lease o la salida del cliente restaura el PAC anterior y solicita retirar la confianza TLS. La instalación y retirada de confianza pueden requerir autorizaciones distintas de macOS; el cliente muestra los estados pendientes.

### Distribución y autorización macOS

El instalador macOS ARM64 aún no tiene firma Developer ID ni notarización. El lanzador gráfico utiliza una pequeña frontera C para dos API de Authorization Services deprecadas por Apple: `AuthorizationExecuteWithPrivileges` y `AuthorizationCopyPrivilegedReference`. Se comprueba el derecho de administrador tanto antes como después de lanzar el proceso. No se ejecuta una shell privilegiada ni se modifica la base de autorizaciones de macOS.

Esto resuelve la consola visible del flujo actual, pero **no constituye todavía el servicio empresarial definitivo**. Antes de distribuir de manera gestionada debe sustituirse por un servicio firmado con `SMAppService`, IPC autenticado mediante identidad de código, firma/notarización y pruebas de instalación, actualización, reinicio y retirada en equipos limpios. No hay servicio privilegiado permanente instalado ni actualización automática del cliente en esta versión.

Referencias de Apple: [AuthorizationExecuteWithPrivileges](https://developer.apple.com/documentation/security/authorizationexecutewithprivileges), [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [registro de servicios](https://developer.apple.com/documentation/servicemanagement/smappservice/register()).

## Permisos y compatibilidad

Los permisos de captura, envío de solicitudes y reporte de estado siguen siendo independientes. Se añade `captureResponses`, mostrado como «Compartir respuestas redactadas», que requiere captura y envío de solicitudes. Las instalaciones anteriores migran con este permiso apagado; no se recuperan respuestas históricas.

La central rechaza una respuesta si falta el permiso adicional. El cliente redacta ambos lados y la central vuelve a aplicar redacción. Cambiar cualquier permiso incrementa la época, descarta la cola anterior, aborta los envíos en curso y elimina inmediatamente los buffers de observación de respuestas. Una respuesta tardía de una época anterior no puede convertirse en un aporte de la época nueva.

La redacción es heurística y no garantiza anonimato. Las cuentas son seudónimas, sin nombre ni correo obligatorio. Los atributos de grupo y el contenido pueden permitir reidentificar al colaborador. No se incorpora identidad personal del navegador ni credenciales de autenticación a la telemetría.

## Solicitudes, respuestas y streaming

El gateway deja pasar contenido sensible, herramientas y entradas con imágenes sin transformarlos. Observa el texto humano compatible; no captura los archivos, imágenes, herramientas ni razonamiento interno. La inspección falla de forma independiente: un error de persistencia o clasificación no cambia la respuesta del modelo.

El proxy conserva los bytes de respuesta y la contrapresión. Una lectura lateral acotada reconoce JSON, SSE, NDJSON y las respuestas comprimidas con gzip, deflate o Brotli. El análisis se realiza al finalizar el stream; no espera a la clasificación para entregar fragmentos al usuario. Se registra por separado error HTTP, conexión interrumpida, formato no compatible, stream incompleto, recorte de captura y límite de generación del modelo.

| Canal | Solicitud | Respuesta | Continuidad |
|---|---|---|---|
| Chat local de Usovia | Último turno humano | Ollama JSON/NDJSON | UUID propio, secuencia explícita |
| API local Ollama / compatible | Último turno textual | Ollama o Chat Completions | Historial exacto o consulta independiente |
| API Chat Completions compatibles | Último mensaje humano | `message.content` / `delta.content`, primera alternativa | Historial exacto o consulta independiente |
| OpenAI Responses / Perplexity Agent | `input` humano | Salida textual / eventos de texto | `previous_response_id` o historial exacto |
| Anthropic Messages | Último mensaje humano | Bloques `text` / eventos `text_delta` | Historial textual exacto |
| Gemini API y Code Assist | Última entrada humana | Texto visible de candidatos | Historial textual exacto |
| Gemini web | Slot conocido de `f.req` | Slot de texto de candidato en `wrb.fr` | ID de conversación del slot conocido |

Gemini web utiliza un protocolo privado y puede cambiar sin aviso. Su parser de respuesta debe validarse con tráfico sintético real de cada versión. No se busca texto recursivamente en el payload. ChatGPT y Claude web todavía necesitan adaptadores específicos; que un navegador confíe en una CA no demuestra captura de sus conversaciones. Los navegadores con proxy, certificados o pinning propios requieren tratamiento específico.

### Límites observables

- Solicitudes inspeccionadas: hasta 1 MiB de cuerpo; las entradas mayores se reenvían sin inspección, sin bloquearlas; el texto capturado se limita a 12.000 caracteres. Las solicitudes comprimidas del proxy externo se reenvían sin inspección de texto.
- Respuestas: lectura lateral de hasta 2 MiB comprimidos y 2 MiB descomprimidos; texto visible de hasta 12.000 caracteres. Se recorta adicionalmente si hace falta para respetar el sobre HTTP de 64 KiB, con indicador explícito.
- Cola cifrada: 100 turnos; lotes de hasta 20 dentro de 60 KiB de JSON codificado. Una cola llena se comunica al colaborador.
- Solo primera alternativa visible del modelo; no se incluyen adjuntos, audio, imágenes, herramientas ni razonamiento interno.
- Los cambios de política y pausas cierran conexiones inspeccionadas como parte de la retirada de observación. El PAC ofrece salida DIRECT. Una CLI con proxy explícito debe retirar sus variables o reactivar Usovia cuando el proxy se detiene.

## Identidad de conversación

Cada aporte tiene ID de turno, ID de conversación, índice, inicio, fin, origen de la continuidad y estado de respuesta. Los índices se asignan antes de la inferencia, por lo que terminar fuera de orden no altera la lectura de los turnos.

La identidad se establece mediante un ID explícito del chat local, un ID del proveedor o la coincidencia exacta del historial textual incluyendo roles e instrucciones. Los identificadores originales y las huellas del historial se sustituyen por HMAC con clave del equipo; la tabla cifrada conserva hasta 300 entradas sin guardar el historial original. No se unen conversaciones por proximidad temporal, proveedor o usuario. Las ramas concurrentes del mismo historial se separan. Si dos chats presentan el mismo historial, la coincidencia se marca ambigua y no se utiliza para unirlos. Los ID explícitos y del proveedor conservan la conversación al cambiar de modelo. Historial con herramientas o imágenes no se considera prueba de continuidad textual.

La central compone sesiones por instalación y UUID; dos instalaciones que presenten el mismo UUID siguen separadas. Los turnos se ordenan por índice. Los huecos, recortes y respuestas no autorizadas aparecen en el detalle. Los aportes antiguos son consultas independientes, no sesiones reconstruidas artificialmente.

## Consola y persistencia

La ruta administrativa `GET /api/conversations` ofrece filtros `account`, `department`, `office` (sucursal), `tag`, `query` y `groupBy`. Buscar selecciona la conversación completa, no únicamente los turnos que coinciden. Los grupos muestran cuentas, conversaciones, turnos y respuestas compartidas. La vista permite revisar solicitudes y respuestas en orden y conservar el contexto antes de formular oportunidades.

El acceso requiere la sesión administrativa; una credencial de un cliente no permite consultar otras cuentas. No hay motor central avanzado nuevo: la clasificación y las sugerencias siguen usando reglas explicables en CPU. La vista de conversaciones prepara los datos autorizados para análisis posteriores.

La persistencia actual conserva siete días y hasta 500 turnos por espacio, con máximo de 100 cuentas. La API de conversaciones usa los 500 registros retenidos, no solo los 25 del resumen. Puede haber historial parcial por retención, permisos o falta de correlación; no se promete reconstruir uso anterior a la instalación. PostgreSQL continúa almacenando el documento del espacio con transacción y bloqueo de fila. Para escalar a empresas con muchos endpoints deben migrarse eventos/sesiones a tablas, índices, RBAC/SSO y políticas de retención configurables.

## Validación

68 pruebas automáticas verifican consentimiento, aislamiento de identidad, orden de turnos, búsqueda con contexto, filtros, redacción en ambos lados, streaming comprimido, retirada inmediata de buffers y reenvío sin bloqueo de credenciales/herramientas. Se realizó una conversación de dos turnos con `qwen2.5:0.5b` en una central local aislada, con captura y lectura ordenada de ambas respuestas. Los datos de esa validación no se incorporan al servidor corporativo.

Las evidencias privadas están en `.runtime/conversations-check`; el informe de integridad del paquete está en `lab/browser-system/evidence/package-1.1.0.json`. La validación de firma/notarización y la transición a SMAppService continúan pendientes; los resultados concretos de la autorización gráfica del sistema deben consignarse tras su prueba local.

Auditoría de dependencias: cero vulnerabilidades conocidas en las dependencias de ejecución. Las herramientas de desarrollo conservan 41 avisos (uno crítico en `tar` transitivo); deben corregirse y validarse antes de distribución empresarial. No se incluyen esas herramientas en el cliente ni como dependencias de ejecución de la central.

La lista de conversaciones entrega metadatos y vista previa. El detalle se carga en páginas de hasta 25 turnos mediante cursor de índice y una fecha de corte de recepción, para evitar duplicados o saltos cuando cambia la retención. Las llegadas posteriores aparecen al actualizar la lectura. Esto mantiene cada respuesta por debajo del [límite de cuerpo de Vercel](https://vercel.com/docs/functions/limitations) (4,5 MB); el navegador puede cargar sucesivamente todos los turnos retenidos.

La autorización de navegadores se serializa para impedir activaciones simultáneas; no se puede reactivar durante una retirada de CA pendiente. La versión está orientada a un usuario interactivo por equipo. El PAC y la confianza TLS de macOS tienen alcance de sistema: equipos compartidos con varios usuarios requieren separación por usuario y atribución por proceso antes de su despliegue. Un ID de cuenta identifica una instalación, no demuestra quién está autenticado en cada servicio web.
