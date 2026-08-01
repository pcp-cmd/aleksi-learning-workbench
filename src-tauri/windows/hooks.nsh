!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Removing legacy Aleksi Workbench sidecar entrypoint"
  Delete "$INSTDIR\resources\sidecar\server.js"
!macroend
