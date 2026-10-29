; Custom NSIS include for electron-builder (package.json -> build.nsis.include).
; Tracked in git: build/ is otherwise generated output (see .gitignore).

; The Tasks engine runs from <install dir>\resources\python\pythonw.exe. If the app
; was killed or crashed, that process can outlive "AI OS.exe" (which electron-builder
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

!macro customInit
  !insertmacro aiOsKillOrphanedEngine
  !insertmacro aiOsDetectExistingInstall
!macroend

!macro customUnInit
  !insertmacro aiOsKillOrphanedEngine
!macroend

; ---------------------------------------------------------------------------------
; First install only: the OneDrive folders the Power Automate flows use.
;
; AI OS and its flows share one folder in OneDrive, AI-OS, with PMO-Inbox,
; Staff-Exchange (requests / profiles / rejected) and PTO-Inbox inside. On a FIRST
; install this creates them, so the app finds them already in place and the first-time
; setup page only has to show how to build the flows. An update (AI OS is already
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
Var aiOsExisting
Var aiOsOneDrive

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
  ${If} $aiOsExisting == "0"
    !insertmacro aiOsFindOneDrive
    ${If} $aiOsOneDrive != ""
      ClearErrors
      CreateDirectory "$aiOsOneDrive\AI-OS\PMO-Inbox"
      CreateDirectory "$aiOsOneDrive\AI-OS\Staff-Exchange\requests"
      CreateDirectory "$aiOsOneDrive\AI-OS\Staff-Exchange\profiles"
      CreateDirectory "$aiOsOneDrive\AI-OS\Staff-Exchange\rejected"
      CreateDirectory "$aiOsOneDrive\AI-OS\PTO-Inbox"
      DetailPrint "AI OS: OneDrive folders are in $aiOsOneDrive\AI-OS"
    ${Else}
      DetailPrint "AI OS: no work OneDrive found; the app creates the folders once OneDrive is signed in"
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
