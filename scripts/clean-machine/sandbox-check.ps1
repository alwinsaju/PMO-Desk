<#
Clean-machine check for the PMO Desk installer. Runs inside Windows Sandbox (see
run-sandbox-test.ps1) or on any Windows machine against an unpacked build.

What it does, in order (nothing here sends mail or opens a mailbox):
  1. (with -Installer) installs PMO Desk silently, per user, into %LOCALAPPDATA%\Programs\PMO Desk,
     then checks it needed no elevation, and the shortcuts and uninstall entry exist
  2. checks the files the app needs (app, bundled python.exe and pythonw.exe, engine, tasks)
  3. runs the engine self-test with the BUNDLED Python (imports, shared task libraries,
     a task-style step on fixture data); the install-folder baseline is taken BEFORE this
  4. starts the Tasks engine from the install (pythonw.exe, as the app does) on a free
     port with a separate data folder, checks /health and /tasks, and proves the install
     folder was not written to
  5. reports (read only) whether Ollama is installed and whether classic Outlook is
     registered for COM
  6. (with -LaunchApp) starts the real app with a FRESH profile (--user-data-dir, never
     the real %APPDATA%\ai-os) and the PMO inbox redirected to an empty temp folder, and
     checks: the NEW desktop.log shows the Tasks engine came up (and how long it took),
     the window appears, a second launch is refused, a graceful quit leaves no process
     behind, and a relaunch comes up again with the first run's data intact
  7. (with -Lifecycle, needs -Installer; ends with PMO Desk UNINSTALLED) installs the same
     installer over the top (data kept), then uninstalls (files, shortcuts and registry
     gone, data kept by design). Refuses to run when PMO Desk or %APPDATA%\ai-os exist.

Writes results.json (and prints a table) to -ResultsDir. Exit code 0 = every
required check passed. Windows PowerShell 5.1 compatible: native programs are run
through Invoke-Native so a line on stderr is never mistaken for a failure.

  .\sandbox-check.ps1 -Installer "C:\Installer\PMO Desk Setup 3.0.0.exe" -ResultsDir C:\Results -LaunchApp -Lifecycle
  .\sandbox-check.ps1 -AppDir "C:\path\to\win-unpacked" -ResultsDir $env:TEMP\aios-check -LaunchApp
#>
param(
    [string]$Installer,
    [string]$AppDir,
    [string]$ResultsDir = (Join-Path $env:TEMP "aios-clean-check"),
    [int]$EnginePort = 8187,
    [switch]$LaunchApp,
    [switch]$Lifecycle
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Name, [bool]$Ok, [string]$Detail, [bool]$Required = $true) {
    $results.Add([pscustomobject]@{ check = $Name; ok = $Ok; required = $Required; detail = $Detail })
    $mark = if ($Ok) { "PASS" } elseif ($Required) { "FAIL" } else { "NOTE" }
    Write-Host ("[{0}] {1} - {2}" -f $mark, $Name, $Detail)
}

function Finish {
    $results | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $ResultsDir "results.json")
    $failed = @($results | Where-Object { $_.required -and -not $_.ok })
    Write-Host ""
    Write-Host ("{0} checks, {1} required failed. Results: {2}" -f $results.Count, $failed.Count, (Join-Path $ResultsDir "results.json"))
    exit $(if ($failed.Count -eq 0) { 0 } else { 1 })
}

# helpers ----------------------------------------------------------------------
function Quote-Arg([string]$a) {
    if ($a -eq "") { return '""' }
    if ($a -notmatch '[\s"]') { return $a }
    return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Stop-Tree([int]$ProcId) {
    if ($ProcId -le 0) { return }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "taskkill.exe"; $psi.Arguments = "/PID $ProcId /T /F"; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    try { $p = [System.Diagnostics.Process]::Start($psi); [void]$p.StandardOutput.ReadToEnd(); [void]$p.StandardError.ReadToEnd(); [void]$p.WaitForExit(15000) } catch { }
}

# Runs a native program to completion with stdout and stderr captured apart. Windows PowerShell 5.1
# turns every stderr line of `& exe 2>&1` into an error record, which `$ErrorActionPreference = "Stop"`
# then throws: a self-test that only logged a warning would be reported as failed (SBX-007).
function Invoke-Native([string]$File, [string[]]$Arguments, [int]$TimeoutSec = 120, [hashtable]$EnvVars, [string]$WorkDir) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = (($Arguments | ForEach-Object { Quote-Arg $_ }) -join " ")
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
    if ($EnvVars) { foreach ($k in $EnvVars.Keys) { if ($null -eq $EnvVars[$k]) { [void]$psi.EnvironmentVariables.Remove($k) } else { $psi.EnvironmentVariables[$k] = [string]$EnvVars[$k] } } }
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    try { [void]$p.Start() } catch { return [pscustomobject]@{ ExitCode = -1; Out = ""; Err = $_.Exception.Message; TimedOut = $false } }
    $so = $p.StandardOutput.ReadToEndAsync()
    $se = $p.StandardError.ReadToEndAsync()
    $timedOut = $false
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { $timedOut = $true; Stop-Tree $p.Id } else { $p.WaitForExit() }
    $code = if ($timedOut) { -2 } else { $p.ExitCode }
    return [pscustomobject]@{ ExitCode = $code; Out = $so.Result; Err = $se.Result; TimedOut = $timedOut }
}

# Runs a script block with process-level environment variables set ($null = remove), then restores them.
function With-Env([hashtable]$Vars, [scriptblock]$Block) {
    $saved = @{}
    foreach ($k in $Vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process"); [Environment]::SetEnvironmentVariable($k, $Vars[$k], "Process") }
    try { & $Block } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process") } }
}

function Get-ProcsUnder([string]$Dir) {
    $prefix = $Dir.TrimEnd('\') + '\'
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
}

# File count and size, ignoring Python's bytecode caches (counted apart), so "not written to" means real files.
function Get-TreeSnapshot([string[]]$Roots) {
    $count = 0; $bytes = 0L; $pyc = 0
    foreach ($r in $Roots) {
        if (-not (Test-Path -LiteralPath $r)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue)) {
            if ($f.FullName -match '\\__pycache__\\' -or $f.Extension -eq ".pyc") { $pyc++; continue }
            $count++; $bytes += $f.Length
        }
    }
    return [pscustomobject]@{ Count = $count; Bytes = $bytes; Pyc = $pyc }
}

function Get-UninstallEntries {
    $out = @()
    foreach ($key in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")) {
        if (-not (Test-Path $key)) { continue }
        foreach ($k in (Get-ChildItem $key -ErrorAction SilentlyContinue)) {
            $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
            if ($p -and $p.DisplayName -like "PMO Desk*") { $out += [pscustomobject]@{ Name = $p.DisplayName; Version = $p.DisplayVersion } }
        }
    }
    return $out
}

function Get-Shortcuts {
    $paths = @((Join-Path ([Environment]::GetFolderPath("Desktop")) "PMO Desk.lnk"), (Join-Path ([Environment]::GetFolderPath("Programs")) "PMO Desk.lnk"))
    $sh = $null
    try { $sh = New-Object -ComObject WScript.Shell } catch { }
    $out = @()
    foreach ($p in $paths) {
        $exists = Test-Path -LiteralPath $p
        $target = $null
        if ($exists -and $sh) { try { $target = $sh.CreateShortcut($p).TargetPath } catch { } }
        $out += [pscustomobject]@{ Path = $p; Exists = $exists; Target = $target }
    }
    return $out
}

function Invoke-Setup([string]$Path) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $Path -ArgumentList "/S" -PassThru -Wait
    return [pscustomobject]@{ ExitCode = $p.ExitCode; Secs = [math]::Round($sw.Elapsed.TotalSeconds, 1) }
}

# 1. install -----------------------------------------------------------------
$defaultAppDir = Join-Path $env:LOCALAPPDATA "Programs\PMO Desk"
$realProfile = Join-Path $env:APPDATA "ai-os"
if ($Lifecycle -and -not $Installer) { Add-Result "lifecycle" $false "-Lifecycle needs -Installer"; Finish }
if ($Lifecycle -and ((Test-Path -LiteralPath (Join-Path $defaultAppDir "PMO Desk.exe")) -or (Test-Path -LiteralPath $realProfile))) {
    Add-Result "clean machine for -Lifecycle" $false "PMO Desk is installed or $realProfile exists; -Lifecycle reinstalls and UNINSTALLS and would touch that data. Use Windows Sandbox or a fresh VM."
    Finish
}
if ($Installer) {
    if (-not (Test-Path -LiteralPath $Installer)) { Add-Result "installer" $false "not found: $Installer"; Finish }
    $setup = Invoke-Setup $Installer
    $AppDir = $defaultAppDir
    Add-Result "silent install" ($setup.ExitCode -eq 0 -and (Test-Path (Join-Path $AppDir "PMO Desk.exe"))) ("exit code {0}, {1:N0} s, into {2}" -f $setup.ExitCode, $setup.Secs, $AppDir)
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Add-Result "install needed no administrator rights (this session is not elevated)" (-not $isAdmin) $(if ($isAdmin) { "this session IS elevated, so the result proves nothing: run it from a normal window" } else { "per-user install into %LOCALAPPDATA%, no prompt" }) $false
    foreach ($s in (Get-Shortcuts)) { Add-Result "shortcut: $($s.Path)" ($s.Exists -and $s.Target -like "*\PMO Desk.exe") $(if ($s.Exists) { "-> $($s.Target)" } else { "missing" }) }
    $entries = @(Get-UninstallEntries)
    Add-Result "one uninstall entry (Settings > Apps)" ($entries.Count -eq 1) ("{0} entr(ies): {1}" -f $entries.Count, (($entries | ForEach-Object { "$($_.Name) $($_.Version)" }) -join "; "))
}
if (-not $AppDir) { Add-Result "app folder" $false "pass -Installer or -AppDir"; Finish }

# 2. files -------------------------------------------------------------------
$res = Join-Path $AppDir "resources"
$py = Join-Path $res "python\python.exe"
$pyw = Join-Path $res "python\pythonw.exe"
$engine = Join-Path $res "app\tasks-engine"
$tasks = Join-Path $res "app\tasks"
foreach ($pair in @(
        @("app executable", (Join-Path $AppDir "PMO Desk.exe")),
        @("bundled Python", $py),
        @("bundled pythonw (the engine runs as this)", $pyw),
        @("Tasks engine", (Join-Path $engine "main.py")),
        @("engine self-test", (Join-Path $engine "selftest.py")),
        @("shift-roster task", (Join-Path $tasks "shift-roster\task.json")),
        @("shared libraries", (Join-Path $tasks "shared\roster_lib\__init__.py")))) {
    Add-Result "file: $($pair[0])" (Test-Path -LiteralPath $pair[1]) $pair[1]
}
if (-not ((Test-Path -LiteralPath $py) -and (Test-Path -LiteralPath $pyw))) { Finish }

# 3. self-test with the bundled Python --------------------------------------------
$snapBefore = Get-TreeSnapshot @($tasks, $engine)   # baseline BEFORE anything runs from the install (SBX-008)
$st = Invoke-Native $py @("selftest.py", "--tasks-dir", $tasks) 300 @{ PYTHONNOUSERSITE = "1"; ELECTRON_RUN_AS_NODE = $null } $engine
Set-Content -LiteralPath (Join-Path $ResultsDir "selftest.txt") -Value ($st.Out + "`r`n--- stderr ---`r`n" + $st.Err) -Encoding UTF8
$report = $null
try { $report = (($st.Out.Trim() -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 1) | ConvertFrom-Json } catch { }
if ($st.TimedOut) {
    Add-Result "engine self-test" $false "timed out after 300 s"
} elseif ($report) {
    Add-Result "engine self-test (bundled Python $($report.python))" ([bool]$report.ok) (($report.checks | ForEach-Object { "{0}={1}" -f $_.id, $(if ($_.ok) { "ok" } else { "FAILED: " + $_.detail }) }) -join "; ")
} else {
    Add-Result "engine self-test" $false ("no JSON report; exit code {0}; stderr: {1}" -f $st.ExitCode, (($st.Err.Trim() -split "`r?`n" | Select-Object -Last 3) -join " | "))
}

# 4. engine from the install, data elsewhere ---------------------------------------
$data = Join-Path $ResultsDir "engine-data"
if (Test-Path $data) { Remove-Item -Recurse -Force $data }
$engineProc = With-Env @{ AI_OS_TASKS_DATA_DIR = $data; PYTHONNOUSERSITE = "1"; ELECTRON_RUN_AS_NODE = $null } {
    Start-Process -FilePath $pyw -ArgumentList @("main.py", "--port", "$EnginePort") -WorkingDirectory $engine -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $ResultsDir "engine.out.log") -RedirectStandardError (Join-Path $ResultsDir "engine.err.log")
}
try {
    $health = $null
    for ($i = 0; $i -lt 240 -and -not $health; $i++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$EnginePort/health" -TimeoutSec 2 } catch { }
    }
    Add-Result "engine /health (pythonw.exe)" ($health -and $health.service -eq "tasks-engine") "port $EnginePort"
    if ($health) {
        $list = Invoke-RestMethod -Uri "http://127.0.0.1:$EnginePort/tasks" -TimeoutSec 10
        $ids = ($list | ForEach-Object { $_.id }) -join ", "
        Add-Result "engine lists the tasks" ($list.Count -ge 6) $ids
    }
} finally {
    if ($engineProc -and -not $engineProc.HasExited) { Stop-Tree $engineProc.Id; [void]$engineProc.WaitForExit(15000) }
}
$snapAfter = Get-TreeSnapshot @($tasks, $engine)
Add-Result "install folder not written to" ($snapBefore.Count -eq $snapAfter.Count -and $snapBefore.Bytes -eq $snapAfter.Bytes) ("files before {0}, after {1}; bytes before {2}, after {3}; __pycache__/.pyc files {4} -> {5}; data in {6}" -f $snapBefore.Count, $snapAfter.Count, $snapBefore.Bytes, $snapAfter.Bytes, $snapBefore.Pyc, $snapAfter.Pyc, $data)
Add-Result "working copy created in the data folder" (Test-Path (Join-Path $data "tasks\shift-roster\task.json")) $data

# 5. read-only facts -----------------------------------------------------------------
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) { $local = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"; if (Test-Path $local) { $ollama = $local } }
Add-Result "Ollama installed (setup installs it when missing)" ([bool]$ollama) $(if ($ollama) { "$($ollama)" } else { "not installed: the setup screen offers the install" }) $false
$outlookCom = Test-Path "Registry::HKEY_CLASSES_ROOT\Outlook.Application\CLSID"
Add-Result "classic Outlook registered for COM (only the four mail tasks need it)" $outlookCom $(if ($outlookCom) { "registered" } else { "not registered" }) $false
$onedrive = $env:OneDriveCommercial; if (-not $onedrive) { $onedrive = $env:OneDrive }
Add-Result "OneDrive signed in (the PMO inbox needs it)" ([bool]$onedrive) $(if ($onedrive) { $onedrive } else { "not signed in: the setup screen explains it" }) $false

# 6. the real app ----------------------------------------------------------------------
# Every launch uses a FRESH profile under -ResultsDir (--user-data-dir): the log waited for is never one
# left by an earlier run, and the real %APPDATA%\ai-os is neither read nor written (SBX-006).
function Test-Health([string]$Url) {
    try { $h = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + "/health") -TimeoutSec 2; return ($h.service -eq "tasks-engine") } catch { return $false }
}

function Get-FileLen([string]$Path) { if (Test-Path -LiteralPath $Path) { return (Get-Item -LiteralPath $Path).Length } else { return 0 } }

function Read-FromOffset([string]$Path, [long]$Offset) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    try {
        $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try { if ($Offset -gt $fs.Length) { $Offset = 0 }; [void]$fs.Seek($Offset, [System.IO.SeekOrigin]::Begin); return (New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() }
    } catch { return "" }
}

function Start-AppProc([string]$Exe, [string]$ProfileDir, [string]$Inbox) {
    $vars = @{
        ELECTRON_RUN_AS_NODE = $null; AI_OS_MODE = $null; AI_OS_PROJECT_DIR = $null; AI_OS_TASKS_PYTHON = $null
        AI_OS_TASKS_DATA_DIR = $null; AI_OS_TASKS_ENGINE_URL = $null; AI_OS_SKIP_TASKS_ENGINE = $null
        AI_OS_PMO_INBOX_DIR = $Inbox                          # never the real inbox
        AI_OS_AI_AUTOSTART = "0"; AI_OS_AI_PREWARM = "0"      # never start the user's Ollama
    }
    return (With-Env $vars { Start-Process -FilePath $Exe -ArgumentList ("--user-data-dir=" + (Quote-Arg $ProfileDir)) -PassThru -WorkingDirectory (Split-Path $Exe) })
}

# Waits until the part of desktop.log written after $Offset says the engine is ready (or a start failure).
function Wait-AppReady($Proc, [string]$LogPath, [long]$Offset, [int]$MaxSec) {
    $failPattern = 'PMO Desk could not start|did not start within|Tasks engine start request failed|could not be started'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $MaxSec) {
        Start-Sleep -Milliseconds 500
        $text = Read-FromOffset $LogPath $Offset
        if ($text -match 'Tasks engine is ready') { return [pscustomobject]@{ Ready = $true; Secs = [math]::Round($sw.Elapsed.TotalSeconds, 1); Why = "" } }
        if ($text -match $failPattern) { return [pscustomobject]@{ Ready = $false; Secs = 0; Why = ((($text -split "`r?`n") | Where-Object { $_ -match $failPattern } | Select-Object -First 2) -join " | ") } }
        if ($Proc.HasExited) { return [pscustomobject]@{ Ready = $false; Secs = 0; Why = "PMO Desk.exe exited with code $($Proc.ExitCode) before the engine was ready" } }
    }
    return [pscustomobject]@{ Ready = $false; Secs = 0; Why = "not ready after $MaxSec s" }
}

# Closes the main window like a user, then reports (and ends) anything still running from the install folder.
function Stop-AppGracefully($Proc, [string]$Dir) {
    $graceful = $false
    for ($i = 0; $i -lt 60 -and -not $Proc.HasExited; $i++) { $Proc.Refresh(); if ($Proc.MainWindowHandle -ne [IntPtr]::Zero) { break }; Start-Sleep -Milliseconds 500 }
    try { $Proc.Refresh(); if ($Proc.CloseMainWindow()) { $graceful = $Proc.WaitForExit(60000) } } catch { }
    if (-not $Proc.HasExited) { Stop-Tree $Proc.Id }
    $deadline = (Get-Date).AddSeconds(40)
    do { $left = @(Get-ProcsUnder $Dir); if ($left.Count -eq 0) { break }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline)
    foreach ($x in $left) { Stop-Tree $x.ProcessId }
    return [pscustomobject]@{ Graceful = $graceful; Left = $left }
}

if ($LaunchApp) {
    $exe = Join-Path $AppDir "PMO Desk.exe"
    $running = @(Get-ProcsUnder $AppDir)
    $foreign = @(8000..8019 | Where-Object { Test-Health "http://127.0.0.1:$_" })
    if ($running.Count -gt 0) {
        Add-Result "no PMO Desk already running from $AppDir" $false "quit it first; this check ends every process under that folder"
    } elseif ($foreign.Count -gt 0) {
        Add-Result "no other Tasks engine on ports 8000-8019" $false ("an engine answers on port(s) {0}: the app would adopt it instead of starting its own, so the launch would prove nothing. Stop it and run again." -f ($foreign -join ","))
    } else {
        $inbox = Join-Path $ResultsDir "empty-pmo-inbox"
        New-Item -ItemType Directory -Force -Path $inbox | Out-Null
        $profileDir = Join-Path $ResultsDir "launch-profile"
        if (Test-Path -LiteralPath $profileDir) { Remove-Item -Recurse -Force -LiteralPath $profileDir }
        $log = Join-Path $profileDir "desktop.log"

        $app = Start-AppProc $exe $profileDir $inbox
        $ready = Wait-AppReady $app $log 0 90
        Add-Result "app starts and brings the Tasks engine up (fresh profile)" $ready.Ready $(if ($ready.Ready) { "new desktop.log: Tasks engine is ready after {0} s; profile {1}" -f $ready.Secs, $profileDir } else { $ready.Why })
        if ($ready.Ready) {
            Add-Result "start time within the app's own budgets (30 s UI + 20 s engine)" ($ready.Secs -le 50) "$($ready.Secs) s from launch to 'Tasks engine is ready'" $false
            $win = $false
            for ($i = 0; $i -lt 60 -and -not $win; $i++) { $app.Refresh(); if ($app.MainWindowHandle -ne [IntPtr]::Zero) { $win = $true } else { Start-Sleep -Milliseconds 500 } }
            Add-Result "main window shown" $win $(if ($win) { "title '$($app.MainWindowTitle)'" } else { "no top-level window within 30 s of the engine being ready" })
            $dataDir = Join-Path $profileDir "tasks-engine\tasks\shift-roster\task.json"
            Add-Result "app keeps task data under its own profile folder" (Test-Path -LiteralPath $dataDir) $dataDir

            $second = Start-AppProc $exe $profileDir $inbox
            $refused = $second.WaitForExit(30000)
            if (-not $refused) { Stop-Tree $second.Id }
            Add-Result "second launch is refused while the app runs (single instance)" ($refused -and -not $app.HasExited) ("second process {0}; first still running: {1}" -f $(if ($refused) { "exited" } else { "did NOT exit" }), (-not $app.HasExited))

            $marker = Join-Path $profileDir "tasks-engine\tasks\shift-roster\input\_aios_marker.txt"
            try { New-Item -ItemType Directory -Force -Path (Split-Path $marker) | Out-Null; Set-Content -LiteralPath $marker -Value "USER" -Encoding ASCII } catch { }
        }
        $quit = Stop-AppGracefully $app $AppDir
        if ($ready.Ready) {
            Add-Result "graceful quit leaves no PMO Desk / python / pythonw process" ($quit.Graceful -and $quit.Left.Count -eq 0) ("window closed -> exited: {0}; still running afterwards: {1}" -f $quit.Graceful, (($quit.Left | ForEach-Object { $_.Name }) -join ", "))

            $offset = Get-FileLen $log
            $app2 = Start-AppProc $exe $profileDir $inbox
            $ready2 = Wait-AppReady $app2 $log $offset 90
            Add-Result "relaunch brings the Tasks engine up again" $ready2.Ready $(if ($ready2.Ready) { "Tasks engine is ready after {0} s" -f $ready2.Secs } else { $ready2.Why })
            Add-Result "data from the first run survives the relaunch" (Test-Path -LiteralPath $marker) $marker
            $quit2 = Stop-AppGracefully $app2 $AppDir
            Add-Result "second quit leaves no process either" ($quit2.Graceful -and $quit2.Left.Count -eq 0) ("exited gracefully: {0}; still running afterwards: {1}" -f $quit2.Graceful, (($quit2.Left | ForEach-Object { $_.Name }) -join ", "))
        }
        if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log (Join-Path $ResultsDir "desktop.log") -Force }
    }
}

# 7. reinstall over the top, then uninstall (-Lifecycle: ends with PMO Desk removed) ----------
if ($Lifecycle) {
    $marker = Join-Path $realProfile "_aios_lifecycle_marker.txt"   # %APPDATA%\ai-os did not exist (checked above)
    New-Item -ItemType Directory -Force -Path $realProfile | Out-Null
    Set-Content -LiteralPath $marker -Value "USER" -Encoding ASCII
    $re = Invoke-Setup $Installer
    $entries = @(Get-UninstallEntries)
    Add-Result "reinstall over the top: exit code 0, app present, one uninstall entry" ($re.ExitCode -eq 0 -and (Test-Path -LiteralPath (Join-Path $AppDir "PMO Desk.exe")) -and $entries.Count -eq 1) ("exit code {0}, {1:N0} s, {2} uninstall entr(ies)" -f $re.ExitCode, $re.Secs, $entries.Count)
    Add-Result "reinstall keeps user data in %APPDATA%\ai-os" (Test-Path -LiteralPath $marker) $marker

    $un = Join-Path $AppDir "Uninstall PMO Desk.exe"
    if (-not (Test-Path -LiteralPath $un)) {
        Add-Result "uninstaller present" $false "not found: $un"
    } else {
        $up = Start-Process -FilePath $un -ArgumentList "/currentuser /S" -PassThru
        [void]$up.WaitForExit(120000)
        # The NSIS uninstaller copies itself to %TEMP% and relaunches, so the first process returns early.
        $deadline = (Get-Date).AddMinutes(4)
        while ((Get-Date) -lt $deadline) {
            $tempCopy = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Un_*" })
            if (-not (Test-Path -LiteralPath (Join-Path $AppDir "PMO Desk.exe")) -and $tempCopy.Count -eq 0) { break }
            Start-Sleep -Seconds 2
        }
        Add-Result "uninstall removes the app" (-not (Test-Path -LiteralPath (Join-Path $AppDir "PMO Desk.exe"))) $AppDir
        $leftShortcuts = @(Get-Shortcuts | Where-Object { $_.Exists })
        Add-Result "uninstall removes the shortcuts" ($leftShortcuts.Count -eq 0) $(if ($leftShortcuts.Count) { ($leftShortcuts | ForEach-Object { $_.Path }) -join "; " } else { "desktop and Start menu shortcuts gone" })
        $leftEntries = @(Get-UninstallEntries)
        Add-Result "uninstall removes the uninstall entry" ($leftEntries.Count -eq 0) "$($leftEntries.Count) entr(ies) left"
        Add-Result "uninstall keeps user data (by design: deleteAppDataOnUninstall is off)" (Test-Path -LiteralPath $marker) $marker
    }
    Remove-Item -Recurse -Force -LiteralPath $realProfile -ErrorAction SilentlyContinue
}

Finish
