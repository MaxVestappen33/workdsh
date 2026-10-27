; Check the exact app process before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid
; 升级流程标记：$dshUpdating 来自命令行 --updated，$dshInstallCompleted 由安装段置位。
; 两者只在安装器构建里使用；卸载器会展开 customCheckAppRunning，所以那里改为
; 现场解析命令行，避免在卸载器里声明未使用变量（构建把警告当错误）。
!ifndef BUILD_UNINSTALLER
  Var dshInstallCompleted
  Var dshUpdating
!endif
; Set by the uninstall page below; "1" means the user asked to remove local data.
; Declared only for the uninstaller pass: the installer pass never expands the
; uninstall pages, and an unreferenced variable is a build-breaking warning.
!ifdef BUILD_UNINSTALLER
  Var dshUninstallDeleteUserData
!endif

; Windows 10 is the hard floor for this carrier: Electron 43 dropped Windows 7/8/8.1
; (Chromium 110), and the bundled DSH Node runtime requires Windows 10 as well. Refuse
; the installation instead of leaving a shortcut that cannot start. Expanded from
; .onInit, before any page or file extraction, so Quit aborts the install cleanly.
; The dialog caption follows the installer name derived from productName.
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "警务助手 不支持当前操作系统版本。$\r$\n$\r$\n当前系统低于 Windows 10。$\r$\n警务助手 需要 Windows 10 或更高版本（Windows 10 / 11 / Server 2016 及以上）才能正常运行，$\r$\n安装已中止。$\r$\n$\r$\n请升级到 Windows 10 或更高版本后，再重新运行安装程序。" /SD IDOK
    Quit
  ${EndIf}
  ; 记录本次是否为覆盖升级：--updated 由客户端更新流程传入。
  StrCpy $dshUpdating "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $dshUpdating "1"
  ${EndIf}
!macroend

!macro customInstall
  StrCpy $dshInstallCompleted "1"
!macroend

; 升级时强制按“仅为我安装”并跳过安装范围页：覆盖升级只能落在原安装位置，
; 再让用户选一次范围既没有意义，也会像许可页一样挡住无人值守的升级流程。
!macro customInstallmode
  StrCpy $isForceCurrentInstall "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

!macro customCheckAppRunning
  ; 客户端在线升级：主程序已主动退出，安装期间保留的是独立的进度进程（同名 exe）。
  ; 这种情况下不能再按可执行文件名判定“应用仍在运行”，否则会强杀进度页并多等 30 秒。
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    Goto dsh_installer_app_stopped
  ${EndIf}
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

; ── 升级体验：只保留“正在安装”进度页，装完自动重启 ──────────────────────
; 调用方以 `--updated` 且不传 `/S` 启动安装器时，许可页/安装模式页/目录页会被
; skipPageIfUpdated 跳过，完成页由下面替换为“升级时跳过”，用户看到的就是
; 解压进度页；安装段完成后由 .onGUIEnd 拉起新版本，无需用户再去找图标。
!ifndef BUILD_UNINSTALLER
  !macro customFinishPage
    !insertmacro skipPageIfUpdated
    Function dshStartApp
      ${if} ${isUpdated}
        StrCpy $R1 "--updated"
      ${else}
        StrCpy $R1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$R1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "dshStartApp"
    !insertmacro MUI_PAGE_FINISH
  !macroend

  ; 静默升级没有 GUI 回调（.onGUIEnd 不执行），用 .onInstSuccess 在安装成功后
  ; 拉起新版本；普通静默安装（无 --updated）保持装完即退。
  Function .onInstSuccess
    StrCmp $dshUpdating "1" 0 dsh_instsuccess_done
    StrCmp $dshInstallCompleted "1" 0 dsh_instsuccess_done
    ExecShell "open" "$INSTDIR\${PRODUCT_FILENAME}.exe" "--updated"
  dsh_instsuccess_done:
  FunctionEnd
!endif

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
