# Worker semántico privado

Este proceso persistente ejecuta embeddings multilingües en CPU. Comparte PostgreSQL y `TENANT_ID` con el Hub, sin llamar a APIs de inferencia externas. Los pesos ONNX se descargan por separado desde el repositorio del modelo aprobado; los textos no se envían a Hugging Face.

La configuración y la operación se describen en [análisis corporativo](../docs/analytics.md). Ejecuta los comandos desde la raíz del repositorio:

```sh
npm ci --omit=dev
npm ci --prefix analytics-worker
# Completa analytics-worker/.env a partir del ejemplo con permisos de archivo 600.
USOVIA_WORKER_ENV_FILE=analytics-worker/.env node analytics-worker/worker.mjs
```

`--once` procesa trabajos disponibles y termina. Los fallos de trabajos devuelven un código distinto de cero. El modo continuo necesita un supervisor de procesos con reinicio y alertas. No está incluido ni se ejecuta como una función de Vercel.

Después de preparar la caché puedes establecer `USOVIA_MODELS_OFFLINE=1`. Se exige la revisión fijada en `server/analytics/domain.mjs`; faltas de archivos producen un error, sin descargar ni recurrir a un servicio externo. Protege la caché contra modificaciones y verifica sus artefactos en tu proceso de distribución.

La ruta de caché debe ser un volumen privado y persistente. La credencial de PostgreSQL debe alcanzar solo la base del Hub autorizado. Los embeddings son derivados sensibles; no son datos anónimos.

La demostración de Vercel también dispone de un executor CPU protegido bajo demanda dentro del Hub. No requiere ejecutar este proceso en un computador personal. Consulta [la operación de la demostración](../docs/product-demo.md).
