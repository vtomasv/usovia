# Seguridad

No publiques vulnerabilidades junto con credenciales, conversaciones o certificados privados. Para reportar un problema, utiliza el mecanismo privado de GitHub Security Advisories del repositorio cuando esté habilitado; evita crear un issue con material sensible.

El proyecto es una implementación funcional en evolución. No constituye todavía una solución empresarial auditada. Los límites de interceptación, consentimiento y retención están documentados en [versión 1.1](docs/version-1.1.md).

- No se almacenan cabeceras de autorización ni cookies de proveedor como telemetría.
- Cada endpoint genera su propia CA; su clave privada no viaja al Hub.
- La redacción automática reconoce patrones limitados y no garantiza anonimización.
- El administrador debe limitar el acceso a la consola y utilizar secretos robustos. La consola actual no incluye SSO ni RBAC granular.
- La auditoría de CI cubre dependencias de producción. Las dependencias de desarrollo tienen vulnerabilidades conocidas que requieren evaluación y actualización; una auditoría de producción correcta no equivale a una auditoría de toda la cadena de suministro.
- Firma, notarización, servicio macOS moderno y revisión independiente son pendientes antes de una distribución corporativa gestionada.

El worker semántico ejecuta inferencia local y lee solo contexto redactado ya autorizado. Los vectores, notas de revisión y exportaciones son derivados sensibles y siguen la retención documentada en [análisis](docs/analytics.md). No son anónimos. El borrado invalida trabajos y manifiestos mediante barreras de consentimiento; no elimina archivos descargados ni backups ajenos. La ingesta JSONB, SSO/RBAC, aislamiento mediante RLS y garantías de purga requieren trabajo adicional antes de una operación empresarial a gran escala.
