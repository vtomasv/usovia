# Cliente macOS 1.3.1: distribución firmada

[Descargar Usovia 1.3 para Apple Silicon](https://github.com/vtomasv/usovia/releases/download/desktop-v1.3.1-macos-arm64/Usovia-1.3.1-arm64.dmg) · [Release y evidencias](https://github.com/vtomasv/usovia/releases/tag/desktop-v1.3.1-macos-arm64) · [Proceso de firma](macos-signing.md)

El DMG incluye Usovia, el motor Ollama 0.40.0 y el ayudante nativo de navegadores. La aplicación y sus 56 componentes Mach-O están firmados con Developer ID Application, timestamp seguro y hardened runtime. Apple aceptó la aplicación y el DMG; ambos incluyen el ticket de notarización. El paquete requiere macOS 13 o posterior en un Mac Apple Silicon y no es una edición para Intel.

SHA-256 del DMG final: `747d80ec02201d61278eeb3aba8727f1e90638e62df35c58de569c1f52596819`.

## Prueba del distribuible

Se montó el DMG en modo de solo lectura, se extrajo la aplicación en un directorio de prueba y se validaron de nuevo su firma, ticket y Gatekeeper. Con un perfil aislado y sin cuenta corporativa se comprobaron el cifrado y recuperación de configuración mediante el llavero, el puente seguro del renderer, el icono de la barra y el cierre de ventana sin finalizar el cliente. El motor incluido descargó qwen2.5:0.5b y generó una respuesta real; se comprobó su detención al salir. La captura permaneció desactivada y no se instalaron CA ni se modificó el proxy del sistema durante esta prueba.

Los hashes originales de las bibliotecas se conservan en `sourceFiles` del inventario del runtime; `files` registra los bytes después de firmarlos. Se verificó su correspondencia con lo distribuido y la integridad del código empaquetado. Los resultados públicos del release solo contienen metadatos de verificación, hashes y tamaños; las claves de firma y credenciales de Apple permanecen en el llavero.

## Autorización y cobertura

La firma identifica al editor como Tomas Vera. macOS puede solicitar acceso de Usovia a su almacenamiento seguro en el llavero. La cuenta corporativa y sus permisos se activan por separado; el cliente comienza sin captura.

La autorización gráfica de navegadores instala la CA propia del endpoint y configura un PAC selectivo solamente después del consentimiento correspondiente y la autorización administrativa local. La firma de Apple no elimina esas solicitudes ni amplía la cobertura de captura.

La captura web dispone de adaptador Gemini; ChatGPT y Claude web siguen pendientes. La prueba de distribución firmada no equivale a una nueva validación completa de Chrome/Safari/Firefox en Mac. Se conservan los límites de proxy, TLS, correlación de sesiones y restauración documentados en [versión 1.1](version-1.1.md) y [pruebas de navegadores](navegadores-macos.md). La API privilegiada heredada del ayudante todavía requiere modernización para distribución corporativa gestionada.

La edición Windows 1.3 mantiene su paquete, hashes y verificación de Chrome/Edge/Firefox independientes; esta publicación no cambia su firma ni su runtime.

## Corrección 1.3.1 del lanzamiento gráfico

Se corrigió una carrera entre el iniciador y el ayudante privilegiado: el iniciador liberaba AuthorizationRef antes de que AuthorizationCopyPrivilegedReference lo recuperara. Una comprobación gráfica de solo diagnóstico reprodujo -60005 al liberar temprano y 0 al esperar. El iniciador ahora espera una confirmación acotada, transmite los errores y conserva el control por lease.

En un Mac real se verificaron el ayudante activo, el PAC efectivo y una conexión por el proxy a la página pública de Gemini con HTTP 200 y validación TLS correcta, conservando un proxy previo en otro adaptador. No se enviaron prompts ni credenciales durante esa comprobación; no equivale a una conversación autenticada ni a probar todos los navegadores. El autotest nativo incluye 11 casos.
