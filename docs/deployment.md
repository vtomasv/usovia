# CI y publicación manual

El repositorio público es [vtomasv/usovia](https://github.com/vtomasv/usovia). GitHub Actions está activo; Vercel se publica por CLI. El proyecto no está conectado a GitHub y `git.deploymentEnabled` está desactivado explícitamente. Los pushes no despliegan la web. No se copian tokens de Vercel a Actions.

## Flujo

1. Un push a `main` o PR ejecuta CI: instalación desde el lockfile, formato, TypeScript, pruebas de API/proxy/consentimiento, auditoría de dependencias de producción del Hub y del worker privado, sintaxis del worker y build.
2. Revisa el resultado del CI y los cambios antes de publicar.
3. En la máquina autenticada y vinculada al proyecto correcto, ejecuta `npm run deploy`. El script `predeploy` comprueba formato, tipos y pruebas. El build de Vercel vuelve a validar tipos y pruebas antes de publicar.
4. Verifica la URL de producción, `/api/health`, el acceso administrativo y la descarga. Un despliegue fallido conserva el anterior. Para revertir, promueve una versión anterior desde Vercel y revierte el commit mediante una nueva confirmación revisable.

La suite omite explícitamente las dos pruebas del ayudante macOS en Linux/Windows y la ejecución de cmd en macOS/Linux. Cada runner ejecuta las pruebas compatibles y reporta esas omisiones. El runner elimina las credenciales de servicios heredadas y falla si faltan los archivos de prueba.

El cliente de escritorio se empaqueta y publica por separado. Un push o despliegue del Hub no genera ni firma un instalador.

## Identidad y autenticación

```sh
git config user.name vtomasv
git config user.email vtomasv@gmail.com
```

Autor y committer deben corresponder a la cuenta autorizada. Los pushes utilizan la sesión GitHub del propietario. No cambies el correo a uno ajeno para eludir las comprobaciones de identidad.

En una nueva máquina, inicia sesión en Vercel y vincula el directorio al proyecto autorizado mediante `npx vercel login` y `npx vercel link`. La conexión local a un proyecto es distinta de conectar un repositorio Git para despliegues automáticos.

En esta máquina se utiliza una configuración de CLI privada dentro de `.vercel-cli`:

```sh
npm run deploy -- --yes --global-config .vercel-cli
```

Ese directorio y `.vercel/project.json` están excluidos de Git. Nunca incluyas tokens en argumentos de commits, workflows o archivos públicos.

## Entornos

Node 22, Vite, `dist`, instalación `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`. Las funciones viven en `api/` y reutilizan `server/` y `shared/`. No reciben certificados privados del endpoint.

Variables privadas de Production: `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`. Variables de configuración: `TENANT_ID`, `ORGANIZATION_NAME`, `PUBLIC_HUB_URL`; descarga opcional `DESKTOP_DOWNLOAD_URL`. Genera secretos distintos y largos. Git no incluye estados locales, credenciales, telemetría, modelos, runtime ni instaladores.

Las variables heredadas del proyecto incluyen acceso a producción en otros entornos; por eso no se utilizan previews. Antes de habilitarlos, prepara una base y secretos independientes y retira del entorno Preview todas las credenciales de producción. No ejecutes código de PR no confiables con ellas.

## Distribución de escritorio

macOS Apple Silicon 1.3 se distribuye firmado con Developer ID y notarizado por Apple; Windows x64 continúa sin Authenticode. El flujo de Mac usa el certificado y el perfil de notarización del llavero del titular, sin exportar claves a CI. Consulta [firma y notarización](macos-signing.md) y [la edición Mac 1.3](version-1.3-macos.md). Windows se compila y publica mediante el workflow nativo bajo demanda, con prueba de captura en Chrome/Edge/Firefox y limpieza de sus CA; no hay distribución Linux ni publicación automática de una CA. La integración gráfica de navegadores de Mac requiere todavía su validación completa. Antes de distribución gestionada, sustituye el ayudante heredado por un servicio macOS moderno y completa las pruebas de cobertura.

## Procesamiento semántico

La demo incluye una función CPU protegida de Vercel para procesamiento bajo demanda. La ingesta y las consultas del dashboard solicitan ejecución de la cola; no necesita un computador personal encendido. Como alternativa, el worker independiente requiere un host persistente privado con la revisión de modelo aprobada y acceso al mismo PostgreSQL/tenant del Hub. Consulta [operación analítica](analytics.md). Los vínculos semánticos siempre esperan embeddings reales; se informa la cobertura y los pendientes. La función privada necesita sus dependencias CPU, presupuesto de ejecución y salida para descargar los activos públicos aprobados; nunca envía texto a una API de inferencia externa. La central 1.2 se publicó y verificó mediante sus APIs autenticadas en producción. El recorrido con cuentas controladas comprobó ingesta, recomendaciones, embeddings locales y Parquet. La presentación y el control del worker se describen en [demostración del producto](product-demo.md).

## Instalador Windows

El workflow separado `Windows installer` se ejecuta bajo demanda. Compila NSIS, instala el paquete en Windows, comprueba DPAPI, bandeja y una inferencia local real, y publica en GitHub Releases solo después del éxito. No utiliza secretos de Vercel ni cambia su integración Git. La web conserva los paquetes de Mac y Windows por separado en `shared/release.mjs`. Consulta [distribución Windows](windows.md).
