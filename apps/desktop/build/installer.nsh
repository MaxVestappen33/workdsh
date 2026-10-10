﻿; Check the exact app process before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid
; Set by the uninstall page below; "1" means the user asked to remove local data.
; Declared only for the uninstaller pass: the installer pass never expands the
; uninstall pages, and an unreferenced variable is a build-breaking warning.
!ifdef BUILD_UNINSTALLER
  Var dshUninstallDeleteUserData
!endif

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 != 0
    Goto dsh_installer_app_stopped
  ${endIf}

  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 dsh_installer_scoped_fallback
    ; Newer versions receive this through Electron's single-instance channel.
    ; 2.0.2 ignores it, so the scoped builder fallback remains necessary for
    ; the first upgrade to a version that supports orderly shutdown.
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --dsh-installer-quit'
    StrCpy $R1 0

  dsh_installer_wait_for_exit:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    IntOp $R1 $R1 + 1
    ; Slow disks, antivirus hooks, and a large physical runtime can keep the
    ; process alive after Cordis disposal begins. Give the orderly handoff a
    ; full 30 seconds before escalating to the scoped forced-close path.
    ${if} $R1 < 60
      Sleep 500
      Goto dsh_installer_wait_for_exit
    ${endIf}

  dsh_installer_scoped_fallback:
    ; The patched builder macros match PoliceAssistant.exe, not every executable
    ; below $INSTDIR. They handle pre-handoff releases and stubborn processes.
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dsh_installer_stop_app
    Quit

  dsh_installer_stop_app:
    DetailPrint "$(appClosing)"
    ; KILL_PROCESS's tasklist fallback excludes $pid. The installer never has
    ; the application executable name, so zero is a safe sentinel here.
    StrCpy $pid 0
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
    Sleep 500
    StrCpy $R1 0

  dsh_installer_wait_for_fallback:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    IntOp $R1 $R1 + 1
    ${if} $R1 > 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dsh_installer_wait_for_fallback
      Quit
    ${endIf}
    Sleep 1000
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
    Sleep 500
    Goto dsh_installer_wait_for_fallback

  dsh_installer_app_stopped:
!macroend

; Uninstall option: let the user remove the local data directory.
; app-builder-lib only deletes user data when "--delete-app-data" is passed or
; "deleteAppDataOnUninstall" is configured; this carrier sets neither, so the
; checkbox below is the single explicit way to drop sessions, credentials and
; installed plugins. The install directory itself is always removed by the
; builder and is not part of this choice.
;
; The page functions live inside a macro because NSIS parses Function bodies
; where they are textually included, and this file is included before MUI2 and
; nsDialogs. Expanding them from customUnWelcomePage defers parsing until both
; macro sets exist.
!macro dshUninstallUserDataPage
  Function un.dshUserDataPageCreate
    !insertmacro MUI_HEADER_TEXT "卸载选项" "选择是否一并删除本机保存的用户数据"
    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endIf}

    ${NSD_CreateLabel} 0u 0u 100% 30u "用户数据默认保留，位于：$\r$\n$APPDATA\PoliceAssistant$\r$\n其中包含会话记录、登录凭据、已安装插件与个人工作区文件。"
    Pop $1

    ${NSD_CreateCheckbox} 0u 38u 100% 12u "一并删除用户数据目录（删除后无法恢复）"
    Pop $2

    nsDialogs::Show
  FunctionEnd

  Function un.dshUserDataPageLeave
    ${NSD_GetState} $2 $0
    StrCpy $dshUninstallDeleteUserData $0
  FunctionEnd
!macroend

!macro customUnWelcomePage
  !insertmacro dshUninstallUserDataPage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.dshUserDataPageCreate un.dshUserDataPageLeave
!macroend

!macro customUnInstall
  ${if} $dshUninstallDeleteUserData == 1
    RMDir /r "$APPDATA\PoliceAssistant"
    DetailPrint "已删除用户数据目录 $APPDATA\PoliceAssistant"
  ${endIf}
!macroend
