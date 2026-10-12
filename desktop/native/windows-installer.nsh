!macro customUnInstall
  SetShellVarContext current
  IfFileExists "$INSTDIR\resources\browser-helper\usovia-windows-browser-helper.exe" 0 usovia_cleanup_done
  ExecWait '"$INSTDIR\resources\browser-helper\usovia-windows-browser-helper.exe" recover "$APPDATA\Usovia\browser-routing" clean' $0
  StrCmp $0 0 usovia_cleanup_done
  MessageBox MB_ICONEXCLAMATION|MB_OK "Confirma en Windows la retirada del certificado de Usovia y cierra la aplicación. Después vuelve a ejecutar la desinstalación. Se conservan los certificados y ajustes de otras aplicaciones." /SD IDOK
  Abort
  usovia_cleanup_done:
!macroend
