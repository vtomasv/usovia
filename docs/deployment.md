# CI y publicación manual

El repositorio público es [vtomasv/usovia](https://github.com/vtomasv/usovia). GitHub Actions está activo; Vercel se publica por CLI. El proyecto no está conectado a GitHub y `git.deploymentEnabled` está desactivado explícitamente. Los pushes no despliegan la web. No se copian tokens de Vercel a Actions.

## Flujo

1. Un push a `main` o PR ejecuta CI: instalación desde el lockfile, formato, TypeScript, pruebas de API/proxy/consentimiento, auditoría de dependencias de producción del Hub y del worker privado, sintaxis del worker y build.
2. Revisa el resultado del CI y los cambios antes de publicar.
3. En la máquina autenticada y vinculada al proyecto correcto, ejecuta `npm run deploy`. El script `predeploy` comprueba formato, tipos y pruebas. El build de Vercel vuelve a validar tipos y pruebas antes de publicar.
4. Verifica la URL de producción, `/api/health`, el acceso administrativo y la descarga. Un despliegue fallido conserva el anterior. Para revertir, promueve una versión anterior desde Vercel y revierte el commit mediante una nueva confirmación revisable.

En Linux se ejecutan 78 pruebas y se omiten explícitamente las dos que requieren macOS. En el Mac con ayudante compilado se ejecutan las 80. El runner elimina las credenciales de servicios heredadas y falla si faltan los archivos de prueba.

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

La versión actual es macOS Apple Silicon sin firma Developer ID ni notarización. No hay build automático de Windows/Linux ni publicación automática de una CA. La nueva autorización gráfica de navegadores requiere todavía una validación completa en un Mac desbloqueado. Antes de distribución gestionada, firma/notariza y sustituye el ayudante heredado por un servicio macOS moderno.

## Worker privado

El proceso semántico no se despliega en Vercel. Requiere un host persistente privado con la revisión de modelo aprobada y acceso al mismo PostgreSQL/tenant del Hub. Consulta [operación analítica](analytics.md). El despliegue web puede mostrar categorías/revisiones y exportar sin worker, pero los vínculos semánticos esperan embeddings reales; se informa esa cobertura. La actualización analítica se probó con QA sintética y PostgreSQL local aislado; no se ejecutaron pruebas con la conexión de producción.
