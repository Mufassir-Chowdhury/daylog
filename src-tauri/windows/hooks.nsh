; Installer hooks (tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; daylog used to be an Electron app, installed per user in
; %LOCALAPPDATA%\Programs\todo (electron-builder names that folder after the
; npm package, which is still called "todo"). Its last versions update
; themselves by running this installer (electron-updater: --updated /S, plus
; --force-run to relaunch), so this installer also takes the Electron copy away. Its data in
; %APPDATA%\daylog is kept: the Tauri app uses the same prefs and activity files.

!define ELECTRON_DIR "$LOCALAPPDATA\Programs\todo"

!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "${ELECTRON_DIR}\Uninstall daylog.exe"
    DetailPrint "Removing the previous (Electron) version of daylog"
    ; It may still be closing after starting this update.
    nsExec::Exec 'taskkill /F /IM daylog.exe'
    Pop $0
    Sleep 500
    ; _?= runs the uninstaller in place and waits for it.
    ExecWait '"${ELECTRON_DIR}\Uninstall daylog.exe" /S /currentuser _?=${ELECTRON_DIR}'
    RMDir /r "${ELECTRON_DIR}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; electron-updater asks for a relaunch with --force-run (this installer's own
  ; flag for that is /R).
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R0
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
!macroend
