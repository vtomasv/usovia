# GitHub → Vercel

El Hub se despliega con la integración Git nativa de Vercel. No se guardan tokens de Vercel en GitHub Actions. El cliente de escritorio se empaqueta y publica por separado; un push del Hub no genera ni firma un instalador.

## Flujo

1. Un push a `main` ejecuta GitHub Actions: instalación desde el lockfile, TypeScript, pruebas de API/proxy/consentimiento, auditoría de dependencias de producción y build.
2. Vercel recibe el mismo commit desde GitHub. Su build vuelve a ejecutar TypeScript y pruebas antes de crear la nueva versión de producción. Por tanto, un fallo de esas comprobaciones impide publicar ese build, aunque Actions y Vercel se ejecuten en paralelo. La auditoría de Actions es una comprobación adicional; no es una dependencia entre ambos sistemas.
3. Solo `main` genera despliegues automáticos. Las demás ramas tienen despliegue desactivado mediante `git.deploymentEnabled`: las variables heredadas del proyecto incluyen acceso a la base de producción, por lo que no se publican previews con esa configuración. Antes de habilitar previews, prepara una base y secretos independientes, y elimina de ese entorno todas las credenciales de producción. No ejecutes código de PR no confiables con ellas.
4. Un despliegue fallido conserva el anterior. Para revertir, promueve un despliegue anterior desde Vercel y revierte el commit en Git con una nueva confirmación revisable.

## Identidad

Configura `git config user.name` con el usuario del propietario y `git config user.email vtomav@gmail.com` en este repositorio. Tanto autor como committer deben corresponder a la cuenta autorizada. El propietario de Vercel debe vincular su cuenta GitHub en sus métodos de autenticación. En Hobby, Vercel exige que el autor del commit sea el propietario del equipo; una identidad no reconocida puede impedir el despliegue. Eso no significa automáticamente que Vercel bloquee la cuenta.

Referencias: [integración Git](https://vercel.com/docs/git), [colaboración e identidad](https://vercel.com/docs/deployments/troubleshoot-project-collaboration), [conexión por CLI](https://vercel.com/docs/cli/git).

## Configuración del Hub

Node 22, Vite, `dist`, instalación `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`. Las funciones viven en `api/` y reutilizan `server/` y `shared/`. No tienen acceso a certificados privados del endpoint.

Variables privadas de Production: `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`. Variables de configuración: `TENANT_ID`, `ORGANIZATION_NAME`, `PUBLIC_HUB_URL`; descarga opcional `DESKTOP_DOWNLOAD_URL`. Genera secretos distintos y largos. No se publica el archivo `.env.local`, configuración de CLI, tokens, base de datos, telemetría, modelos, runtime ni instaladores.

Para conectar el proyecto existente con autorización del propietario:

```sh
npx vercel link
npx vercel git connect https://github.com/PROPIETARIO/usovia.git
```

No uses una cuenta GitHub distinta ni cambies el correo a uno ajeno para eludir las reglas. Verifica en el primer despliegue que `VERCEL_GIT_COMMIT_SHA` corresponde al commit publicado y que GitHub reconoce su autor.

## Límite de distribución

La versión actual de escritorio es macOS Apple Silicon sin firma Developer ID ni notarización. No hay build automático de Windows/Linux ni publicación automática de una CA. La autorización gráfica de la nueva integración de navegadores requiere todavía una validación completa en un Mac desbloqueado. Antes de distribuir de forma gestionada, hay que firmar/notarizar y sustituir el ayudante de autorización heredado por un servicio macOS moderno.
