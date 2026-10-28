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
!macroend

!macro customUnInit
  !insertmacro aiOsKillOrphanedEngine
!macroend
