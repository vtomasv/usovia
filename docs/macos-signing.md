# Distribución firmada de macOS

El cliente para Apple Silicon usa Developer ID Application para distribución directa mediante DMG y ZIP. La firma del programa y la CA TLS propia de cada endpoint tienen propósitos diferentes: la firma identifica al editor y permite a Gatekeeper validar el paquete; la CA solo se instala mediante el consentimiento del participante y la autorización administrativa local. La notarización no habilita captura ni elimina esos permisos.

## Preparación en el Mac del titular

1. Crear un certificado Developer ID Application en Xcode e instalarlo con su clave privada en el llavero. No se necesitan certificados Apple Distribution ni Developer ID Installer para el DMG.
2. Crear una contraseña específica de aplicación y guardarla con `xcrun notarytool store-credentials usovia-notary --apple-id CORREO --team-id TEAM_ID`. Introducir la contraseña únicamente en el prompt seguro local. No exportar ni subir la clave privada al repositorio.
3. Instalar las dependencias bloqueadas con `npm ci`. Preparar `desktop/runtime` desde los recursos oficiales de Ollama con `node scripts/bundle-runtime.mjs /ruta/Ollama.app/Contents/Resources`.

## Compilación y controles

Ejecutar `npm run desktop:package:signed`. El script requiere macOS arm64, una única identidad válida Developer ID Application y el perfil existente del llavero. Si hay certificados de varios equipos, seleccionar el equipo con `USOVIA_SIGNING_TEAM_ID`. `APPLE_KEYCHAIN_PROFILE` permite elegir otro perfil.

El proceso compila el ayudante de navegadores y firma los ejecutables y bibliotecas Mach-O incluidos en Resources usando hardened runtime, timestamp seguro y ninguna excepción adicional. Los procesos Electron reciben únicamente `allow-jit`. No se añade `disable-library-validation`, acceso a cámara, micrófono ni `get-task-allow`. El inventario de Ollama conserva los hashes de origen en `sourceFiles` y registra los hashes de los binarios firmados en `files` antes de sellar la aplicación.

La aplicación se envía a Apple, se exige estado Accepted y se adjunta el ticket antes de crear los distribuibles. Se firma y notariza también el DMG final y se adjunta su ticket. Una decisión rechazada, falta de identidad, firma incorrecta o verificación fallida impide considerar terminado el paquete. Los ZIP contienen la aplicación con su ticket; el ZIP no admite stapling propio.

Los controles finales verifican todas las firmas Mach-O y su equipo/timestamp/hardened runtime, los tickets de aplicación y DMG, Gatekeeper, el código empaquetado y el inventario del motor local. Artefactos en `desktop/release-signed`; resultados y registros de Apple en `.runtime/mac-signing`, ignorados por Git. No se guardan contraseñas en esos registros.

`node scripts/package-macos-signed.mjs --verify-existing` vuelve a verificar los artefactos existentes sin volver a firmarlos ni enviarlos a Apple. Si una subida pierde la conexión, consultar el ID registrado y `notarytool info` antes de repetirla.

Cerrar otras instancias de Usovia y ejecutar `node scripts/smoke-macos.mjs` para comprobar el cliente empaquetado: perfil aislado, captura desactivada, sin cuenta corporativa, cifrado del llavero, puente del renderer, icono de la barra, cierre de ventana sin salir y respuesta real de qwen2.5:0.5b. Esta comprobación puede descargar el modelo y solicitar acceso local al llavero; no modifica certificados raíz ni proxy del sistema. No valida por sí sola los navegadores externos ni sustituye la matriz de cobertura publicada.

Las credenciales permanecen en el llavero de este host. Este flujo no configura un runner Mac permanente ni exporta certificados a GitHub Actions. Una futura automatización en runners macOS necesitará secretos de distribución y autorización específica para alojarlos en ese servicio.

Fuentes: [Developer ID de Apple](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/), [notarización de Apple](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [flujo personalizado de notarización](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow), [electron-builder v26](https://www.electron.build/v26/docs/mac/).
