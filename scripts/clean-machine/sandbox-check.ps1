<#
Clean-machine check for the AI OS installer. Runs inside Windows Sandbox (see
run-sandbox-test.ps1) or on any Windows machine against an unpacked build.

What it does, in order (nothing here sends mail or opens a mailbox):
  1. (with -Installer) installs AI OS silently, per user, into %LOCALAPPDATA%\Programs\AI OS
  2. checks the files the app needs are there (app, bundled Python, engine, tasks)
  3. runs the engine self-test with the BUNDLED Python (imports, shared task libraries,
     a task-style step on fixture data)
  4. starts the Tasks engine from the install on a free port with a separate data
     folder, checks /health and /tasks, and proves the install folder was not written to
  5. reports (read only) whether Ollama is installed and whether classic Outlook is
     registered for COM
  6. (with -LaunchApp) starts the real app with the PMO inbox redirected to an empty
     temp folder and waits for its log to show the Tasks engine came up

Writes results.json (and prints a table) to -ResultsDir. Exit code 0 = every
required check passed. Windows PowerShell 5.1 compatible.

  .\sandbox-check.ps1 -Installer "C:\Installer\AI OS Setup 2.0.0.exe" -ResultsDir C:\Results -LaunchApp
  .\sandbox-check.ps1 -AppDir "C:\path\to\win-unpacked" -ResultsDir $env:TEMP\aios-check
#>
param(
    [string]$Installer,
    [string]$AppDir,
    [string]$ResultsDir = (Join-Path $env:TEMP "aios-clean-check"),
    [int]$EnginePort = 8187,
    [switch]$LaunchApp
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

# 1. install -----------------------------------------------------------------
if ($Installer) {
    if (-not (Test-Path -LiteralPath $Installer)) { Add-Result "installer" $false "not found: $Installer"; Finish }
    $started = Get-Date
    $proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
    $AppDir = Join-Path $env:LOCALAPPDATA "Programs\AI OS"
    Add-Result "silent install" ($proc.ExitCode -eq 0 -and (Test-Path (Join-Path $AppDir "AI OS.exe"))) ("exit code {0}, {1:N0} s, into {2}" -f $proc.ExitCode, ((Get-Date) - $started).TotalSeconds, $AppDir)
}
if (-not $AppDir) { Add-Result "app folder" $false "pass -Installer or -AppDir"; Finish }

# 2. files -------------------------------------------------------------------
$res = Join-Path $AppDir "resources"
$py = Join-Path $res "python\python.exe"
$engine = Join-Path $res "app\tasks-engine"
$tasks = Join-Path $res "app\tasks"
foreach ($pair in @(
        @("app executable", (Join-Path $AppDir "AI OS.exe")),
        @("bundled Python", $py),
        @("Tasks engine", (Join-Path $engine "main.py")),
        @("engine self-test", (Join-Path $engine "selftest.py")),
        @("shift-roster task", (Join-Path $tasks "shift-roster\task.json")),
        @("shared libraries", (Join-Path $tasks "shared\roster_lib\__init__.py")))) {
    Add-Result "file: $($pair[0])" (Test-Path -LiteralPath $pair[1]) $pair[1]
}
if (-not (Test-Path -LiteralPath $py)) { Finish }

# 3. self-test with the bundled Python --------------------------------------------
try {
    $raw = & $py -I (Join-Path $engine "selftest.py") --tasks-dir $tasks 2>&1 | Out-String
    $report = ($raw.Trim() -split "`r?`n")[-1] | ConvertFrom-Json
    Add-Result "engine self-test (bundled Python $($report.python))" ([bool]$report.ok) (($report.checks | ForEach-Object { "{0}={1}" -f $_.id, $(if ($_.ok) { "ok" } else { "FAILED: " + $_.detail }) }) -join "; ")
} catch {
    Add-Result "engine self-test" $false $_.Exception.Message
}

# 4. engine from the install, data elsewhere ---------------------------------------
$data = Join-Path $ResultsDir "engine-data"
if (Test-Path $data) { Remove-Item -Recurse -Force $data }
$before = (Get-ChildItem -Recurse -File $tasks | Measure-Object).Count
$env:AI_OS_TASKS_DATA_DIR = $data
$env:PYTHONNOUSERSITE = "1"
$engineProc = Start-Process -FilePath $py -ArgumentList @("main.py", "--port", "$EnginePort") -WorkingDirectory $engine -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $ResultsDir "engine.out.log") -RedirectStandardError (Join-Path $ResultsDir "engine.err.log")
try {
    $health = $null
    for ($i = 0; $i -lt 60 -and -not $health; $i++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$EnginePort/health" -TimeoutSec 2 } catch { }
    }
    Add-Result "engine /health" ($health -and $health.service -eq "tasks-engine") "port $EnginePort"
    if ($health) {
        $list = Invoke-RestMethod -Uri "http://127.0.0.1:$EnginePort/tasks" -TimeoutSec 10
        $ids = ($list | ForEach-Object { $_.id }) -join ", "
        Add-Result "engine lists the tasks" ($list.Count -ge 6) $ids
    }
    $after = (Get-ChildItem -Recurse -File $tasks | Measure-Object).Count
    Add-Result "install folder not written to" ($before -eq $after) "files before $before, after $after; data in $data"
    Add-Result "working copy created in the data folder" (Test-Path (Join-Path $data "tasks\shift-roster\task.json")) $data
} finally {
    if ($engineProc -and -not $engineProc.HasExited) { & taskkill.exe /PID $engineProc.Id /T /F | Out-Null }
}

# 5. read-only facts -----------------------------------------------------------------
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) { $local = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"; if (Test-Path $local) { $ollama = $local } }
Add-Result "Ollama installed (setup installs it when missing)" ([bool]$ollama) $(if ($ollama) { "$($ollama)" } else { "not installed: the setup screen offers the install" }) $false
$com = & reg.exe query "HKCR\Outlook.Application\CLSID" 2>$null
Add-Result "classic Outlook registered for COM (only the four mail tasks need it)" ($LASTEXITCODE -eq 0) $(if ($LASTEXITCODE -eq 0) { "registered" } else { "not registered" }) $false
$onedrive = $env:OneDriveCommercial; if (-not $onedrive) { $onedrive = $env:OneDrive }
Add-Result "OneDrive signed in (the PMO inbox needs it)" ([bool]$onedrive) $(if ($onedrive) { $onedrive } else { "not signed in: the setup screen explains it" }) $false

# 6. the real app ----------------------------------------------------------------------
if ($LaunchApp) {
    $inbox = Join-Path $ResultsDir "empty-pmo-inbox"
    New-Item -ItemType Directory -Force -Path $inbox | Out-Null
    $env:AI_OS_PMO_INBOX_DIR = $inbox   # never the real inbox, even though a clean machine has none
    $env:AI_OS_TASKS_DATA_DIR = $null
    $app = Start-Process -FilePath (Join-Path $AppDir "AI OS.exe") -PassThru
    $log = $null
    $logOk = $false
    for ($i = 0; $i -lt 90 -and -not $logOk; $i++) {
        Start-Sleep -Seconds 1
        foreach ($name in @("AI OS", "ai-os")) {
            $candidate = Join-Path $env:APPDATA "$name\desktop.log"
            if (Test-Path $candidate) { $log = $candidate; if ((Get-Content $candidate -Raw) -match "Tasks engine is ready") { $logOk = $true } }
        }
    }
    Add-Result "app starts and brings the Tasks engine up" $logOk $(if ($log) { $log } else { "no desktop.log found" })
    if ($log) { Copy-Item $log (Join-Path $ResultsDir "desktop.log") -Force }
    $dataDir = $null
    foreach ($name in @("AI OS", "ai-os")) { $c = Join-Path $env:APPDATA "$name\tasks-engine\tasks\shift-roster\task.json"; if (Test-Path $c) { $dataDir = $c } }
    Add-Result "app keeps task data under the app-data folder" ([bool]$dataDir) $(if ($dataDir) { $dataDir } else { "not found" })
    if ($app -and -not $app.HasExited) { & taskkill.exe /PID $app.Id /T /F | Out-Null }
}

Finish
