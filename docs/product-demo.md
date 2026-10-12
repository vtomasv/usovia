# Mostrar Usovia 1.2 en Vercel

Hub publicado: https://usovia-hub-demo.vercel.app. La central 1.2 mantiene compatibilidad con el cliente de escritorio 1.1. El acceso administrativo utiliza la contraseña del Hub ya configurada; no se publica ninguna credencial.

## Recorrido de presentación

1. Abre la consola corporativa y selecciona la etiqueta `demostracion-controlada` en Inteligencia de uso.
2. Revisa categorías y procesos de Atención y Finanzas. Son cuatro cuentas y conversaciones de ejemplos controlados, sin datos de colaboradores reales.
3. Abre Mapa semántico y selecciona una sesión. Los vínculos relacionan solicitudes equivalentes en español e inglés usando embeddings reales calculados localmente.
4. Abre la conversación para mostrar solicitud, respuesta, continuidad y límites de captura.
5. Abre Biblioteca de soluciones. Las candidatas tienen señal de aceptación; ninguna se presenta como validada por una persona. Un responsable puede revisar el contexto y registrar su propia valoración.
6. Exporta turnos o sesiones a Parquet, con metadatos por defecto y texto redactado opcional.
7. Para un colaborador nuevo, crea una cuenta, entrega su activación mediante el canal corporativo y la URL del Hub. El colaborador instala el cliente y elige sus permisos antes de compartir aportes.

Los ejemplos se generaron con `qwen2.5:7b-instruct` del Ollama local y se enviaron usando el controlador real del cliente, incluida redacción, consentimiento separado, cola, sincronización y lectura de recomendaciones. Fue una verificación programática; no constituye una nueva validación de interceptación universal de navegadores ni sustituye la instalación del cliente.

La inferencia produjo respuestas completas y respuestas limitadas por tokens; el dashboard conserva esas diferencias. Los textos y valores son ficticios y están identificados por departamento, sucursal y etiqueta de demostración. No representan productividad, aceptación ni resultados reales de empleados.

## Procesamiento privado en Vercel

La central ejecuta el modelo propio de embeddings en una función CPU protegida dentro de la misma cuenta Vercel. No requiere un Mac encendido ni APIs externas de inferencia. El nuevo ejemplo de verificación se indexó automáticamente en Vercel; quedan cinco sesiones de demostración (una repite una plantilla controlada para comprobar el disparo automático). El controlador no inició ningún servicio continuo en el Mac.

La ingesta responde primero y registra una tarea mediante `waitUntil`. La tarea invoca una función interna con firma HMAC temporal usando un secreto que ya existe en el backend. Los tokens de instalaciones y las solicitudes sin firma no pueden ejecutar ese endpoint. El dashboard también solicita procesar pendientes al abrir o actualizar el análisis.

La función descarga únicamente activos públicos de la revisión aprobada desde Hugging Face, comprueba tamaños y SHA-256, y después deshabilita descargas del runtime de inferencia. El texto permanece en el backend del Hub; las descargas no contienen prompts. La caché temporal y el modelo caliente pueden reutilizarse dentro de la misma instancia, pero no son almacenamiento permanente.

Se reservan hasta 60 segundos por invocación; el executor intenta drenar lotes de cuatro dentro de un presupuesto de 40 segundos. Mantiene leases, tres intentos y la barrera de borrado. Si quedan trabajos, una nueva ingesta o actualización del dashboard los vuelve a solicitar. No constituye una cola con entrega garantizada ni procesamiento permanente durante una ausencia total de solicitudes; para mayor escala añade un servicio de colas/worker privado supervisado.

La función pesada está separada de las APIs ordinarias y el paquete incluye solo los binarios Linux x64 necesarios. Los pesos no se suben con el código ni se publican en Git. Este enfoque utiliza la capacidad y cuotas de Functions del proyecto existente; no se contrató un nuevo servicio ni se cambió el plan. Supervisa invocaciones, CPU, memoria, fallos y tiempos de carga antes de dimensionar uso empresarial.

El worker independiente del repositorio sigue disponible para empresas que quieran ejecutar el procesamiento en infraestructura propia. En esta demostración la ejecución semántica ya está en Vercel; la validación programática distinguió el ejemplo repetido de nuevas respuestas del LLM.

## Operación y publicación

`/api/health` identifica la versión 1.2 y sus capacidades analíticas. Se verificaron acceso autenticado, consultas del dashboard, directorio y exportación Parquet en el despliegue de producción. No se deshabilitaron autenticación ni validación TLS.

Los commits y pushes se atribuyen a `vtomasv <vtomasv@gmail.com>`. GitHub Actions valida el código; Vercel sigue publicándose por CLI, sin conectar el repositorio a despliegues Git automáticos. Consulta [publicación y rollback](deployment.md).
