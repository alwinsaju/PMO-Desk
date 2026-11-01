; Custom NSIS include for electron-builder (package.json -> build.nsis.include).
; Tracked in git: build/ is otherwise generated output (see .gitignore).

; ---------------------------------------------------------------------------------
; Look of the wizard. The welcome / finish pages and the header band are dark, with art
; drawn from the app's own wallpaper (build/installer/*.bmp, made by
; scripts/build-installer-art.py). NSIS can theme only those; the pages in between (the
; folder choice and the progress list) keep the system's own light controls, and the
; uninstaller keeps its stock wording and light panes beside the same dark sidebar.
; ---------------------------------------------------------------------------------

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Welcome to PMO Desk"
  !define MUI_WELCOMEPAGE_TEXT "PMO Desk is a desktop workspace where you and a local AI work side by side. The AI runs on this computer.$\r$\n$\r$\nThis wizard installs it. Click Next to choose where it goes."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW aiOsWelcomeShow
  !insertmacro MUI_PAGE_WELCOME

  ; Defined after the page: the $mui.* controls exist only once MUI_PAGE_WELCOME has run.
  ; The header band's controls (title, subtitle, background) are the wizard window's own and
  ; keep their colors for every later page, so they are darkened here, once. (MUI builds its
  ; header colors before electron-builder's customHeader hook runs, so a define cannot do it.)
  Function aiOsWelcomeShow
    Push $0
    GetDlgItem $0 $HWNDPARENT 1037
    SetCtlColors $0 "F5F7FA" "0A0C16"
    GetDlgItem $0 $HWNDPARENT 1038
    SetCtlColors $0 "B9C1D6" "0A0C16"
    GetDlgItem $0 $HWNDPARENT 1034
    SetCtlColors $0 "" "0A0C16"
    GetDlgItem $0 $HWNDPARENT 1046
    SetCtlColors $0 "" "0A0C16"
    Pop $0
    SetCtlColors $mui.WelcomePage "" "0A0C16"
    SetCtlColors $mui.WelcomePage.Title "F5F7FA" "0A0C16"
    SetCtlColors $mui.WelcomePage.Text "B9C1D6" "0A0C16"
  FunctionEnd
!macroend

; The default finish page, plus the dark colors. StartApp is the same function
; electron-builder defines for its own finish page (assistedInstaller.nsh), so
; "Open PMO Desk" still launches the app as the user (and with --updated on an update).
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "PMO Desk is ready"
  !define MUI_FINISHPAGE_TEXT "PMO Desk is installed.$\r$\n$\r$\nThe first time it opens, it checks that this computer has the local AI it needs and walks you through the rest."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open PMO Desk"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW aiOsFinishShow
  !insertmacro MUI_PAGE_FINISH

  ; NSIS colors a control through SetCtlColors; a themed checkbox ignores it, so the theme
  ; is switched off for that one control.
  Function aiOsFinishShow
    SetCtlColors $mui.FinishPage "" "0A0C16"
    SetCtlColors $mui.FinishPage.Title "F5F7FA" "0A0C16"
    SetCtlColors $mui.FinishPage.Text "B9C1D6" "0A0C16"
    System::Call 'uxtheme::SetWindowTheme(i $mui.FinishPage.Run, w " ", w " ")'
    SetCtlColors $mui.FinishPage.Run "B9C1D6" "0A0C16"
  FunctionEnd
!macroend



; The Tasks engine runs from <install dir>\resources\python\pythonw.exe. If the app
; was killed or crashed, that process can outlive "PMO Desk.exe" (which electron-builder
; already stops by name) and keep files in the install folder locked, failing an
; upgrade or uninstall. This runs before the install dir is known, so it matches the
; path suffix instead; another Python (anywhere else) is never touched. taskkill /T
; also ends the tasks the engine spawned. Every failure is ignored.
!macro aiOsKillOrphanedEngine
  Push $0
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'Name=''pythonw.exe''' | Where-Object { $$_.ExecutablePath -like '*\resources\python\pythonw.exe' } | ForEach-Object { taskkill.exe /F /T /PID $$_.ProcessId | Out-Null }"`
  Pop $0 ; nsExec result
  Pop $0 ; restore the caller's $0
!macroend

; Upgrading from the product's old name ("AI OS"): the old program is a different .exe name in
; the same install folder (the installer reuses the folder it recorded, because the appId is
; unchanged), so a running old copy is stopped, and the old program file and the old
; Desktop / Start menu shortcuts are removed after the new ones are made. Without this an
; update would leave two programs and two shortcuts. Every failure is ignored.
!macro aiOsStopOldApp
  Push $0
  nsExec::Exec `taskkill.exe /F /T /IM "AI OS.exe"`
  Pop $0
  Pop $0
!macroend

!macro aiOsRemoveOldBranding
  Delete "$INSTDIR\AI OS.exe"
  Delete "$DESKTOP\AI OS.lnk"
  Delete "$SMPROGRAMS\AI OS.lnk"
!macroend

!macro customInit
  !insertmacro aiOsStopOldApp
  !insertmacro aiOsKillOrphanedEngine
  !insertmacro aiOsDetectExistingInstall
!macroend

!macro customUnInit
  !insertmacro aiOsKillOrphanedEngine
!macroend

; ---------------------------------------------------------------------------------
; First install only: the OneDrive folders the Power Automate flows use.
;
; PMO Desk and its flows share one folder in OneDrive, AI-OS, with PMO-Inbox,
; Staff-Exchange (requests / profiles / rejected) and PTO-Inbox inside. On a FIRST
; install this creates them, so the app finds them already in place and the first-time
; setup page only has to show how to build the flows. An update (PMO Desk is already
; installed) creates nothing and touches nothing.
;
; The OneDrive folder is read from OneDrive's own account list in the registry, so the
; installer needs no email address and no user name: HKCU\Software\Microsoft\OneDrive\
; Accounts\Business1 ... UserFolder is the work account's sync folder (for example
; "C:\Users\pat\OneDrive - Deloitte (O365D)"). The OneDriveCommercial variable is the
; fallback. With no work OneDrive signed in nothing is created here and the app offers
; to create the folders once OneDrive is signed in. Every failure is ignored: the app
; creates whatever is missing and the install itself must never fail over a folder.
;
; It also writes <userData>\pmo\first-time-setup.json ({"status":"pending"}), which is
; what makes the app open the first-time setup page before the home screen. An existing
; file (a reinstall after an uninstall keeps the user's data) is left as it is.
; ---------------------------------------------------------------------------------
; The two variables are only used by the installer; declaring them in the uninstaller's
; pass too makes NSIS warn about unused variables, and the build treats warnings as errors.
!ifndef BUILD_UNINSTALLER
  Var aiOsExisting
  Var aiOsOneDrive
!endif

!macro aiOsDetectExistingInstall
  StrCpy $aiOsExisting "0"
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    StrCpy $aiOsExisting "1"
  ${EndIf}
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    StrCpy $aiOsExisting "1"
  ${EndIf}
!macroend

!macro aiOsFindOneDrive
  StrCpy $aiOsOneDrive ""
  StrCpy $1 1
  ${While} $1 < 10
    ReadRegStr $2 HKCU "Software\Microsoft\OneDrive\Accounts\Business$1" "UserFolder"
    ${If} $2 != ""
    ${AndIf} ${FileExists} "$2\*.*"
      StrCpy $aiOsOneDrive $2
      ${Break}
    ${EndIf}
    IntOp $1 $1 + 1
  ${EndWhile}
  ${If} $aiOsOneDrive == ""
    ReadEnvStr $2 "OneDriveCommercial"
    ${If} $2 != ""
    ${AndIf} ${FileExists} "$2\*.*"
      StrCpy $aiOsOneDrive $2
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  Push $0
  Push $1
  Push $2
  !insertmacro aiOsRemoveOldBranding
  ${If} $aiOsExisting == "0"
    !insertmacro aiOsFindOneDrive
    ${If} $aiOsOneDrive != ""
      ClearErrors
      CreateDirectory "$aiOsOneDrive\AI-OS\PMO-Inbox"
      CreateDirectory "$aiOsOneDrive\AI-OS\Staff-Exchange\requests"
      CreateDirectory "$aiOsOneDrive\AI-OS\Staff-Exchange\profiles"
      CreateDirectory "$aiOsOneDrive\AI-OS\Staff-Exchange\rejected"
      CreateDirectory "$aiOsOneDrive\AI-OS\PTO-Inbox"
      DetailPrint "PMO Desk: OneDrive folders are in $aiOsOneDrive\AI-OS"
    ${Else}
      DetailPrint "PMO Desk: no work OneDrive found; the app creates the folders once OneDrive is signed in"
    ${EndIf}
    ; The first-time setup page runs once, on the first launch after a fresh install.
    ${IfNot} ${FileExists} "$APPDATA\ai-os\pmo\first-time-setup.json"
      CreateDirectory "$APPDATA\ai-os\pmo"
      FileOpen $0 "$APPDATA\ai-os\pmo\first-time-setup.json" w
      ${IfNot} ${Errors}
        FileWrite $0 `{"status":"pending"}`
        FileClose $0
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend
