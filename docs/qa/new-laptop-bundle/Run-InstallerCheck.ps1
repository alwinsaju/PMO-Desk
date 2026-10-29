<#
.SYNOPSIS
  One-command installer check for AI OS on a NEW (clean) Windows 11 laptop.

.DESCRIPTION
  Replaces scripts\clean-machine\*.ps1 for machines where Windows Sandbox is not
  available. Works on Windows PowerShell 5.1 (the one every Windows 11 has). Writes
  results.json, results.md and plain-text logs (no screenshots) into -ResultsDir.

  Full run, on the clean laptop (installs for real, per user, no administrator rights):

      .\Run-InstallerCheck.ps1 -Installer "D:\AI OS Setup 2.0.0.exe"
      .\Run-InstallerCheck.ps1 -Installer "D:\AI OS Setup 2.0.0.exe" -PreviousInstaller "D:\AI OS Setup 1.0.0.exe"

  Dry run on a machine that already has AI OS (no installer is executed, nothing is
  installed, the real profile is not touched): point it at an UNPACKED COPY of the app
  (the folder that holds "AI OS.exe" and "resources"):

      .\Run-InstallerCheck.ps1 -AppDir "C:\scratch\copy-of-win-unpacked"

  What it does, in order (see README.md for the full table):
    0 preflight        machine facts, hostile environment variables, existing install guard
    1 installer        integrity (SHA-256), manifest (asInvoker = no admin prompt), signature
    2 install          silent per-user install, time, registry entry, shortcuts, payload vs manifest
    3 engine           bundled Python self-test and Tasks engine with an EMPTY PATH, twice
                       (second start = simulated reinstall: user data kept, shipped files refreshed)
    4 first launch     real app, first-launch time against the app's own start budgets, Setup report
                       and the Setup self-test through the app's own API
    5 second launch    single-instance behaviour while running
    6 quit             graceful quit leaves no AI OS, python, pythonw or new ollama process
    7 relaunch         data from the first run survives, second start time
    8 reinstall        installer over the top keeps user data; installer while the app RUNS
    9 uninstall        files, shortcuts and registry gone; user data kept (by design)
   10 custom path      install under a path with spaces and a non-ASCII letter
   11 upgrade          (with -PreviousInstaller) 1.0.0 -> 2.0.0 over the top

  SAFETY. The PMO inbox is redirected to an empty folder (AI_OS_PMO_INBOX_DIR) for every
  launch. The four mail tasks (weekly-aging-report, weekly-backlog-report,
  deployment-dep-weekend-mailer, monthly-report-deck) are only ever LISTED (GET); nothing
  is started, approved, sent or reset. The only POST the script makes is the Setup screen's
  own "run-selftest" action. It never presses install-Ollama or download-model, and by
  default it stops the app from starting Ollama (AI_OS_AI_AUTOSTART=0).

  Exit code: 0 = no check FAILED, 1 = at least one FAIL, 3 = refused to start (preflight).
  Warnings (WARN) never change the exit code; read them.

.PARAMETER Installer          "AI OS Setup <version>.exe". Real install (clean machine only).
.PARAMETER AppDir             Unpacked app folder. Dry run: no install, no uninstall.
.PARAMETER PreviousInstaller  Optional "AI OS Setup 1.0.0.exe": also tests the upgrade.
.PARAMETER ResultsDir         Where results.json / results.md / logs go. Default .\results\<time>.
.PARAMETER Quick              Skip reinstall-while-running, custom path, upgrade.
.PARAMETER LeaveInstalled     At the end, leave a pristine (never launched) AI OS installed, so the
                              manual checklist starts from a true first launch. Default: machine
                              is left clean (uninstalled, test profile removed).
.PARAMETER KeepTestData       Do not delete the profile folder the test created.
.PARAMETER AllowExistingInstall  Run even though AI OS is already installed (it will be replaced
                              and, unless -KeepTestData, its profile removed. Do not use on a machine
                              with data you care about).
.PARAMETER SkipLaunch         Do not start the Electron app (engine and payload checks only).
.PARAMETER AllowOllamaStart   Let the app start Ollama (default: AI_OS_AI_AUTOSTART=0).
.PARAMETER ExpectedSha256     SHA-256 of the installer on the source machine (FAIL when different).
#>
[CmdletBinding()]
param(
    [string]$Installer,
    [string]$AppDir,
    [string]$PreviousInstaller,
    [string]$ResultsDir,
    [switch]$Quick,
    [switch]$LeaveInstalled,
    [switch]$KeepTestData,
    [switch]$AllowExistingInstall,
    [switch]$SkipLaunch,
    [switch]$AllowOllamaStart,
    [string]$ExpectedSha256,
    [int]$InstallTimeoutMinutes = 12,
    [int]$LaunchTimeoutSeconds = 150
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
try { [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy } catch { }

# ---------------------------------------------------------------- constants ------------
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataFolder = Join-Path $ScriptRoot "data"
$ProductName = "AI OS"
# NSIS key of this app (electron-builder derives it from appId com.aios.desktop; read from a real install of 2.0.0).
$AppGuid = "3dec7c8f-642f-5dc8-a98d-cee7af750c97"
$MailerTasks = @("weekly-aging-report", "weekly-backlog-report", "deployment-dep-weekend-mailer", "monthly-report-deck")
$ExpectedTasks = @("december-disconnect", "deployment-dep-weekend-mailer", "monthly-report-deck", "shift-roster", "weekly-aging-report", "weekly-backlog-report")
$NoPath = "C:\aios-no-such-dir"
# The app's own budgets (desktop\launch-config.cjs BUNDLED_START_TIMEOUT_MS, src\app\api\tasks-engine\start\route.ts START_TIMEOUT_MS):
$UiBudgetSec = 30
$EngineBudgetSec = 20
$StartedAt = Get-Date
$Stamp = $StartedAt.ToString("yyyyMMdd-HHmmss")
if (-not $ResultsDir) { $ResultsDir = Join-Path $ScriptRoot ("results\" + $Stamp) }
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$ResultsDir = (Resolve-Path -LiteralPath $ResultsDir).Path
$LogsDir = Join-Path $ResultsDir "logs"
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
$RunLog = Join-Path $ResultsDir "run.log"
$EmptyInbox = Join-Path $ResultsDir "empty-pmo-inbox"
New-Item -ItemType Directory -Force -Path $EmptyInbox | Out-Null

$Results = New-Object System.Collections.Generic.List[object]
$Script:Aborted = $false
$Script:StartedProcs = New-Object System.Collections.Generic.List[int]

# ---------------------------------------------------------------- logging --------------
function Log([string]$Text) {
    $line = "[{0}] {1}" -f (Get-Date).ToString("HH:mm:ss"), $Text
    Write-Host $line
    try { Add-Content -LiteralPath $RunLog -Value $line -Encoding UTF8 } catch { }
}

function Add-Result([string]$Phase, [string]$Name, [string]$Status, [string]$Detail) {
    # Status: PASS | FAIL | WARN | INFO | SKIP
    $Results.Add([pscustomobject]@{ phase = $Phase; check = $Name; status = $Status; detail = $Detail })
    $color = switch ($Status) { "PASS" { "Green" } "FAIL" { "Red" } "WARN" { "Yellow" } default { "Gray" } }
    $d = $Detail; if ($d.Length -gt 400) { $d = $d.Substring(0, 400) + " ..." }
    Write-Host ("  [{0}] {1} - {2}" -f $Status, $Name, $d) -ForegroundColor $color
    try { Add-Content -LiteralPath $RunLog -Value ("  [{0}] {1} - {2}" -f $Status, $Name, $Detail) -Encoding UTF8 } catch { }
}

function Phase([string]$Title) { Write-Host ""; Write-Host ("== " + $Title) -ForegroundColor Cyan; try { Add-Content -LiteralPath $RunLog -Value ("`r`n== " + $Title) -Encoding UTF8 } catch { } }

# ---------------------------------------------------------------- helpers --------------
function Quote-Arg([string]$a) {
    if ($a -eq "") { return '""' }
    if ($a -notmatch '[\s"]') { return $a }
    return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# Runs a native program to completion without PowerShell's stderr-as-error behaviour (5.1).
function Invoke-Native([string]$File, [string[]]$Arguments, [int]$TimeoutSec = 120, [hashtable]$Env, [string]$WorkDir) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = (($Arguments | ForEach-Object { Quote-Arg $_ }) -join " ")
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
    if ($Env) { foreach ($k in $Env.Keys) { if ($null -eq $Env[$k]) { [void]$psi.EnvironmentVariables.Remove($k) } else { $psi.EnvironmentVariables[$k] = [string]$Env[$k] } } }
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try { [void]$p.Start() } catch { return [pscustomobject]@{ ExitCode = -1; Out = ""; Err = $_.Exception.Message; TimedOut = $false; Secs = 0 } }
    $so = $p.StandardOutput.ReadToEndAsync()
    $se = $p.StandardError.ReadToEndAsync()
    $timedOut = $false
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { $timedOut = $true; Stop-Tree $p.Id }
    else { $p.WaitForExit() }
    $code = if ($timedOut) { -2 } else { $p.ExitCode }
    return [pscustomobject]@{ ExitCode = $code; Out = $so.Result; Err = $se.Result; TimedOut = $timedOut; Secs = [math]::Round($sw.Elapsed.TotalSeconds, 1) }
}

function Stop-Tree([int]$ProcId) {
    if ($ProcId -le 0) { return }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "taskkill.exe"; $psi.Arguments = "/PID $ProcId /T /F"; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    try { $p = [System.Diagnostics.Process]::Start($psi); [void]$p.StandardOutput.ReadToEnd(); [void]$p.StandardError.ReadToEnd(); [void]$p.WaitForExit(15000) } catch { }
}

# Run a script block with process-level environment variables set ($null = remove), then restore.
function With-Env([hashtable]$Vars, [scriptblock]$Block) {
    $saved = @{}
    foreach ($k in $Vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process"); [Environment]::SetEnvironmentVariable($k, $Vars[$k], "Process") }
    try { & $Block } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process") } }
}

function Get-ProcsUnder([string]$Dir) {
    if (-not $Dir) { return @() }
    $prefix = $Dir.TrimEnd('\') + '\'
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
}

function Get-OllamaPids { return @(Get-Process -Name "ollama", "ollama app", "ollama_llama_server" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }

function Test-PortFree([int]$Port) {
    try { $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port); $l.Start(); $l.Stop(); return $true } catch { return $false }
}
function Get-FreePort([int]$From, [int]$To) { for ($p = $From; $p -le $To; $p++) { if (Test-PortFree $p) { return $p } }; return 0 }

function Test-Health([string]$Url) {
    try { $h = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + "/health") -TimeoutSec 2; return ($h.service -eq "tasks-engine") } catch { return $false }
}

function Wait-Health([string]$Url, [int]$MaxSec) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $MaxSec) { if (Test-Health $Url) { return [math]::Round($sw.Elapsed.TotalSeconds, 1) }; Start-Sleep -Milliseconds 250 }
    return -1
}

function Get-ForeignEngines {
    $found = @()
    foreach ($p in 8000..8019) { if (Test-Health "http://127.0.0.1:$p") { $found += $p } }
    return $found
}

function Read-FromOffset([string]$Path, [long]$Offset) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    try {
        $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try { if ($Offset -gt $fs.Length) { $Offset = 0 }; [void]$fs.Seek($Offset, [System.IO.SeekOrigin]::Begin); $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8); return $sr.ReadToEnd() } finally { $fs.Dispose() }
    } catch { return "" }
}
function Get-FileLen([string]$Path) { if (Test-Path -LiteralPath $Path) { return (Get-Item -LiteralPath $Path).Length } else { return 0 } }

function Get-LogTime([string]$Text, [string]$Pattern) {
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match $Pattern -and $line -match '^\[(?<ts>[^\]]+)\]') {
            try { return [DateTime]::Parse($Matches['ts'], [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) } catch { }
        }
    }
    return $null
}

function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Get-TreeSnapshot([string[]]$Roots) {
    $count = 0; $bytes = 0L; $newest = [DateTime]::MinValue
    foreach ($r in $Roots) {
        if (-not (Test-Path -LiteralPath $r)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\__pycache__\\' -and $_.Extension -ne ".pyc" })) {
            $count++; $bytes += $f.Length; if ($f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc }
        }
    }
    return [pscustomobject]@{ Count = $count; Bytes = $bytes; Newest = $newest }
}
function Get-PycacheCount([string[]]$Roots) {
    $n = 0
    foreach ($r in $Roots) { if (Test-Path -LiteralPath $r) { $n += @(Get-ChildItem -LiteralPath $r -Recurse -Directory -Filter "__pycache__" -Force -ErrorAction SilentlyContinue).Count } }
    return $n
}

# Where the installer says AI OS is installed (<hive>\Software\<guid> InstallLocation), or $null.
function Get-InstallLocation([string]$Hive) {
    $k = "$Hive\Software\$AppGuid"
    if (Test-Path $k) { $v = (Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue).InstallLocation; if ($v) { return $v } }
    return $null
}

function Get-UninstallEntries {
    $out = @()
    foreach ($hive in "HKCU:", "HKLM:") {
        foreach ($sub in "Software\Microsoft\Windows\CurrentVersion\Uninstall", "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall") {
            $key = "$hive\$sub"
            if (-not (Test-Path $key)) { continue }
            foreach ($k in (Get-ChildItem $key -ErrorAction SilentlyContinue)) {
                $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
                if ($p -and ($k.PSChildName -eq $AppGuid -or $p.DisplayName -like "$ProductName*")) {
                    $out += [pscustomobject]@{ Hive = $hive; Key = $k.PSChildName; Name = $p.DisplayName; Version = $p.DisplayVersion; InstallLocation = (Get-InstallLocation $hive); UninstallString = $p.UninstallString }
                }
            }
        }
    }
    return $out
}

function Get-Shortcuts {
    $desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "AI OS.lnk"
    $start = Join-Path ([Environment]::GetFolderPath("Programs")) "AI OS.lnk"
    $res = @()
    $sh = $null
    try { $sh = New-Object -ComObject WScript.Shell } catch { }
    foreach ($p in $desktop, $start) {
        $target = $null; $exists = Test-Path -LiteralPath $p
        if ($exists -and $sh) { try { $target = $sh.CreateShortcut($p).TargetPath } catch { } }
        $res += [pscustomobject]@{ Path = $p; Exists = $exists; Target = $target }
    }
    return $res
}

function Get-UserDataCandidates { return @((Join-Path $env:APPDATA "ai-os"), (Join-Path $env:APPDATA "AI OS")) }

function Save-Evidence([string]$Source, [string]$Name) {
    try { if (Test-Path -LiteralPath $Source) { Copy-Item -LiteralPath $Source -Destination (Join-Path $LogsDir $Name) -Force } } catch { }
}

function Wait-ProcessGone([int[]]$Pids, [int]$MaxSec) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $MaxSec) {
        $alive = @($Pids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($alive.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

# ---------------------------------------------------------------- installer ops --------
function Invoke-Installer([string]$Path, [string]$TargetDir, [string]$Label) {
    $argText = "/S"
    if ($TargetDir) { $argText += " /D=$TargetDir" }   # /D= must be last and unquoted (NSIS)
    Log ("running installer silently: {0} {1}" -f (Split-Path $Path -Leaf), $argText)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = $null
    $env2 = @{ ELECTRON_RUN_AS_NODE = $null }
    With-Env $env2 { $Script:tmpProc = Start-Process -FilePath $Path -ArgumentList $argText -PassThru }
    $p = $Script:tmpProc
    $null = $p.Handle
    $done = $p.WaitForExit($InstallTimeoutMinutes * 60 * 1000)
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    if (-not $done) { Stop-Tree $p.Id; return [pscustomobject]@{ Ok = $false; ExitCode = -2; Secs = $secs; TimedOut = $true } }
    $p.WaitForExit()
    return [pscustomobject]@{ Ok = ($p.ExitCode -eq 0); ExitCode = $p.ExitCode; Secs = $secs; TimedOut = $false }
}

function Invoke-Uninstaller([string]$Dir) {
    $un = Join-Path $Dir "Uninstall AI OS.exe"
    if (-not (Test-Path -LiteralPath $un)) { return [pscustomobject]@{ Ok = $false; Secs = 0; Note = "Uninstall AI OS.exe not found in $Dir" } }
    Log "running uninstaller silently: $un /currentuser /S"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $un -ArgumentList "/currentuser /S" -PassThru
    $null = $p.Handle
    [void]$p.WaitForExit(120000)
    # The NSIS uninstaller copies itself to %TEMP% and relaunches, so the first process returns early:
    # wait for the install folder to go and for the temp copy ("Un_*.exe") to end.
    $deadline = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $deadline) {
        $temp = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Un_*" })
        $gone = -not (Test-Path -LiteralPath (Join-Path $Dir "AI OS.exe"))
        if ($gone -and $temp.Count -eq 0) { break }
        Start-Sleep -Seconds 2
    }
    return [pscustomobject]@{ Ok = $true; Secs = [math]::Round($sw.Elapsed.TotalSeconds, 1); Note = "" }
}

# ---------------------------------------------------------------- payload --------------
function Test-Payload([string]$Dir, [string]$Phase, [bool]$MatchesAudit) {
    $required = @(
        "AI OS.exe", "resources\python\python.exe", "resources\python\pythonw.exe", "resources\python\python313.dll",
        "resources\python\vcruntime140.dll", "resources\python\Lib\site-packages\numpy\__init__.py",
        "resources\python\Lib\site-packages\scipy\optimize\__init__.py", "resources\python\Lib\site-packages\fastapi\__init__.py",
        "resources\app\package.json", "resources\app\.next\BUILD_ID", "resources\app\node_modules\next\dist\bin\next",
        "resources\app\desktop\main.cjs", "resources\app\desktop\launch-config.cjs", "resources\app\desktop\preload.cjs", "resources\app\desktop\icon.ico",
        "resources\app\tasks-engine\main.py", "resources\app\tasks-engine\workcopy.py", "resources\app\tasks-engine\selftest.py",
        "resources\app\tasks\shared\roster_lib\__init__.py", "resources\app\tasks\shared\winter_lib\__init__.py", "resources\app\tasks\shared\assets\deloitte-logo.png"
    )
    foreach ($t in $ExpectedTasks) { $required += "resources\app\tasks\$t\task.json" }
    $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Dir $_)) })
    if ($missing.Count -eq 0) { Add-Result $Phase "required runtime files present" "PASS" ("{0} files checked (app, bundled Python, Next server, engine, 6 tasks, shared libs)" -f $required.Count) }
    else { Add-Result $Phase "required runtime files present" "FAIL" ("missing: " + ($missing -join "; ")) }

    $manifestCsv = Join-Path $DataFolder "expected-payload-2.0.0.csv"
    if (Test-Path -LiteralPath $manifestCsv) {
        $expected = @{}
        foreach ($row in (Import-Csv -LiteralPath $manifestCsv)) { $expected[$row.path.ToLowerInvariant()] = [int64]$row.size }
        $root = (Resolve-Path -LiteralPath $Dir).Path.TrimEnd('\')
        $actual = @{}
        foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)) { $actual[$f.FullName.Substring($root.Length + 1).ToLowerInvariant()] = $f.Length }
        $miss = @($expected.Keys | Where-Object { -not $actual.ContainsKey($_) })
        $sizeDiff = @($expected.Keys | Where-Object { $actual.ContainsKey($_) -and $actual[$_] -ne $expected[$_] })
        $extra = @($actual.Keys | Where-Object { -not $expected.ContainsKey($_) -and $_ -notmatch '__pycache__' -and $_ -ne "uninstall ai os.exe" -and $_ -notmatch '\.pyc$' })
        $summary = "expected {0} files, found {1}; missing {2}, size differs {3}, unexpected extra {4}" -f $expected.Count, $actual.Count, $miss.Count, $sizeDiff.Count, $extra.Count
        if ($miss.Count -eq 0 -and $sizeDiff.Count -eq 0) {
            Add-Result $Phase "installed files equal the audited payload" "PASS" $summary
        } elseif ($MatchesAudit) {
            Add-Result $Phase "installed files equal the audited payload" "FAIL" ($summary + ". First missing: " + (($miss | Select-Object -First 5) -join ", ") + " First size diff: " + (($sizeDiff | Select-Object -First 5) -join ", "))
        } else {
            Add-Result $Phase "installed files equal the audited payload" "WARN" ($summary + " (installer is not the audited build, so a difference is expected)")
        }
        if ($extra.Count -gt 0) { Add-Result $Phase "unexpected extra files in install folder" "INFO" (($extra | Select-Object -First 8) -join ", ") }
    } else { Add-Result $Phase "installed files equal the audited payload" "SKIP" "data\expected-payload-2.0.0.csv not found" }

    $keyJson = Join-Path $DataFolder "expected-keyfiles-2.0.0.json"
    if (Test-Path -LiteralPath $keyJson) {
        $keys = (Get-Content -LiteralPath $keyJson -Raw | ConvertFrom-Json).key_sha256
        $bad = @()
        foreach ($prop in $keys.PSObject.Properties) {
            $path = Join-Path $Dir $prop.Name
            if (-not (Test-Path -LiteralPath $path)) { $bad += ($prop.Name + " (missing)"); continue }
            if ((Get-Sha256 $path) -ne $prop.Value) { $bad += $prop.Name }
        }
        if ($bad.Count -eq 0) { Add-Result $Phase "key files are byte-identical to the audited build" "PASS" ("{0} files hashed (SHA-256)" -f @($keys.PSObject.Properties).Count) }
        elseif ($MatchesAudit) { Add-Result $Phase "key files are byte-identical to the audited build" "FAIL" ("differ: " + ($bad -join "; ")) }
        else { Add-Result $Phase "key files are byte-identical to the audited build" "WARN" ("differ (not the audited build): " + ($bad -join "; ")) }
    }

    $tasksDir = Join-Path $Dir "resources\app\tasks"
    $shipped = @()
    foreach ($t in $ExpectedTasks) { foreach ($d in "config", "input", "output", "templates", "reference") { if (Test-Path -LiteralPath (Join-Path $tasksDir "$t\$d")) { $shipped += "$t\$d" } } }
    if ($shipped.Count -eq 0) { Add-Result $Phase "task config/input/output/templates/reference are not shipped (by design)" "INFO" "a fresh install has NO rotation-config.json, winter/analytics config, Names.xlsx, Holiday Roster or monthly reference workbooks: copy them from the old machine (see MANUAL-CHECKLIST.md, step 'Move your data')" }
    else { Add-Result $Phase "task data folders shipped" "WARN" ("unexpected: " + ($shipped -join ", ")) }
}

# ---------------------------------------------------------------- engine standalone ----
function Start-EngineProc([string]$Dir, [int]$Port, [string]$DataDir, [string]$Label, [string]$PathValue) {
    $py = Join-Path $Dir "resources\python\pythonw.exe"
    $eng = Join-Path $Dir "resources\app\tasks-engine"
    $o = Join-Path $LogsDir ("engine-$Label.out.log"); $e = Join-Path $LogsDir ("engine-$Label.err.log")
    $vars = @{ AI_OS_TASKS_DATA_DIR = $DataDir; PYTHONNOUSERSITE = "1"; ELECTRON_RUN_AS_NODE = $null }
    if ($PathValue) { $vars["PATH"] = $PathValue }
    $Script:tmpProc = $null
    With-Env $vars { $Script:tmpProc = Start-Process -FilePath $py -ArgumentList @("main.py", "--port", "$Port") -WorkingDirectory $eng -PassThru -WindowStyle Hidden -RedirectStandardOutput $o -RedirectStandardError $e }
    $null = $Script:tmpProc.Handle
    $Script:StartedProcs.Add($Script:tmpProc.Id)
    return $Script:tmpProc
}

function Test-EngineStandalone([string]$Dir, [string]$Phase, [string]$Tag) {
    $py = Join-Path $Dir "resources\python\python.exe"
    $eng = Join-Path $Dir "resources\app\tasks-engine"
    $tasks = Join-Path $Dir "resources\app\tasks"
    if (-not (Test-Path -LiteralPath $py)) { Add-Result $Phase "bundled Python" "FAIL" "python.exe missing"; return }
    $snapBefore = Get-TreeSnapshot @($tasks, $eng)      # BASELINE FIRST: before the self-test or the engine run
    $pycBefore = Get-PycacheCount @($tasks, $eng)

    # a) self-test exactly like Setup runs it (console python, PYTHONNOUSERSITE=1, cwd = tasks-engine), with an EMPTY PATH
    $r = Invoke-Native $py @("selftest.py", "--tasks-dir", $tasks) 300 @{ PATH = $NoPath; PYTHONNOUSERSITE = "1"; ELECTRON_RUN_AS_NODE = $null } $eng
    Set-Content -LiteralPath (Join-Path $LogsDir "selftest-$Tag.txt") -Value ($r.Out + "`r`n--- stderr ---`r`n" + $r.Err) -Encoding UTF8
    $report = $null
    try { $report = (($r.Out.Trim() -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 1) | ConvertFrom-Json } catch { }
    if ($r.TimedOut) { Add-Result $Phase "bundled-Python self-test, empty PATH" "FAIL" "timed out after 300 s" }
    elseif ($report -and $report.ok) { Add-Result $Phase "bundled-Python self-test, empty PATH ($Tag)" "PASS" ("Python {0}; {1}; {2} s" -f $report.python, (($report.checks | ForEach-Object { $_.id + "=ok" }) -join " "), $r.Secs) }
    else {
        $why = if ($report) { (($report.checks | Where-Object { -not $_.ok } | ForEach-Object { $_.id + ": " + $_.detail }) -join "; ") } else { ("no JSON; exit {0}; {1}" -f $r.ExitCode, ($r.Err.Trim() -split "`r?`n" | Select-Object -Last 3) -join " ") }
        Add-Result $Phase "bundled-Python self-test, empty PATH ($Tag)" "FAIL" $why
    }

    # b) the engine, started like the app starts it (pythonw.exe, console-less, output to files)
    $port = Get-FreePort 8187 8199
    if ($port -eq 0) { Add-Result $Phase "free port for the engine test" "FAIL" "8187-8199 are all busy"; return }
    $url = "http://127.0.0.1:$port"
    $data = Join-Path $ResultsDir "engine-data-$Tag"
    if (Test-Path -LiteralPath $data) { Remove-Item -Recurse -Force -LiteralPath $data }
    $p1 = Start-EngineProc $Dir $port $data "$Tag-1" $NoPath
    $secs = Wait-Health $url ($EngineBudgetSec * 3)
    if ($secs -lt 0) {
        $tail = ""; try { $tail = (Get-Content -LiteralPath (Join-Path $LogsDir "engine-$Tag-1.err.log") -Tail 6) -join " | " } catch { }
        Add-Result $Phase "engine /health (pythonw, empty PATH, first start)" "FAIL" ("no answer within {0} s. {1}" -f ($EngineBudgetSec * 3), $tail)
        Stop-Tree $p1.Id; return
    }
    if ($secs -gt $EngineBudgetSec) { Add-Result $Phase "engine first start within the app's $EngineBudgetSec s budget" "FAIL" ("{0} s: the app gives up after {1} s and refuses to start" -f $secs, $EngineBudgetSec) }
    elseif ($secs -gt ($EngineBudgetSec * 0.6)) { Add-Result $Phase "engine first start within the app's $EngineBudgetSec s budget" "WARN" ("{0} s (over 60% of the {1} s budget; a slower disk or antivirus scan could tip it)" -f $secs, $EngineBudgetSec) }
    else { Add-Result $Phase "engine first start within the app's $EngineBudgetSec s budget" "PASS" ("{0} s (pythonw, empty PATH, cold data folder)" -f $secs) }
    Add-Result $Phase "engine /health ($Tag)" "PASS" ("service=tasks-engine at {0}, own PID {1}" -f $url, $p1.Id)

    $list = @()
    try { $list = @(Invoke-RestMethod -Uri "$url/tasks" -TimeoutSec 20 | ForEach-Object { $_ }) } catch { Add-Result $Phase "GET /tasks" "FAIL" $_.Exception.Message }
    $ids = @($list | ForEach-Object { $_.id } | Sort-Object)
    if (($ids -join ",") -eq ($ExpectedTasks -join ",")) { Add-Result $Phase "GET /tasks lists the 6 shipped tasks" "PASS" ($ids -join ", ") }
    else { Add-Result $Phase "GET /tasks lists the 6 shipped tasks" "FAIL" ("got: " + ($ids -join ", ")) }
    $notResting = @($list | Where-Object { $_.state -ne "resting" } | ForEach-Object { $_.id + "=" + $_.state })
    if ($notResting.Count -eq 0) { Add-Result $Phase "all tasks start in state 'resting'" "PASS" "no run is pending on a fresh install" } else { Add-Result $Phase "all tasks start in state 'resting'" "FAIL" ($notResting -join ", ") }
    $inputsBad = @()
    foreach ($t in $ExpectedTasks) {
        try { $x = Invoke-RestMethod -Uri "$url/tasks/$t/inputs" -TimeoutSec 20; if (-not $x.ok) { $inputsBad += $t } } catch { $inputsBad += $t }
    }
    if ($inputsBad.Count -eq 0) { Add-Result $Phase "GET /tasks/<id>/inputs for all 6 tasks (read only)" "PASS" "every task answers; no input present yet (fresh install)" } else { Add-Result $Phase "GET /tasks/<id>/inputs" "FAIL" ($inputsBad -join ", ") }

    $dataTasks = Join-Path $data "tasks"
    $treeBad = @()
    foreach ($t in $ExpectedTasks) {
        if (-not (Test-Path -LiteralPath (Join-Path $dataTasks "$t\task.json"))) { $treeBad += "$t\task.json" }
        foreach ($d in "input", "output", "config", "scripts") { if (-not (Test-Path -LiteralPath (Join-Path $dataTasks "$t\$d"))) { $treeBad += "$t\$d" } }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dataTasks "shared\roster_lib\__init__.py"))) { $treeBad += "shared\roster_lib" }
    if ($treeBad.Count -eq 0) { Add-Result $Phase "working copy created on first start" "PASS" ("tree under {0}: 6 tasks with input/output/config/scripts, shared libs" -f $dataTasks) } else { Add-Result $Phase "working copy created on first start" "FAIL" ("missing: " + ($treeBad -join ", ")) }

    # c) simulated reinstall: user data in, engine restarted (this is what the app does after every reinstall)
    try {
        $mk = @{
            "shift-roster\input\_aios_marker_input.txt" = "USER"; "shift-roster\output\_aios_marker_output.txt" = "USER"; "shift-roster\config\_aios_marker_config.json" = "{}"
            "weekly-aging-report\config\_aios_marker.json" = "{}"; "shared\roster\Names.xlsx" = "USER-NAMES"; "shared\roster-reference\_aios_Holiday Roster.xlsx" = "USER-HOLIDAY"
        }
        foreach ($k in $mk.Keys) { Set-Content -LiteralPath (Join-Path $dataTasks $k) -Value $mk[$k] -Encoding ASCII }
        $strays = @("shared\roster_lib\_aios_stray.py", "shift-roster\_aios_stray.txt")
        foreach ($s in $strays) { Set-Content -LiteralPath (Join-Path $dataTasks $s) -Value "STRAY" -Encoding ASCII }
        Set-Content -LiteralPath (Join-Path $data "history.jsonl") -Value '{"_aios":"history"}' -Encoding ASCII
    } catch { Add-Result $Phase "write user-data markers" "FAIL" $_.Exception.Message }
    Stop-Tree $p1.Id
    $gone = Wait-ProcessGone @($p1.Id) 15
    $left1 = @(Get-ProcsUnder $Dir)
    if ($gone -and $left1.Count -eq 0) { Add-Result $Phase "engine stop leaves no process ($Tag)" "PASS" "taskkill /T /F (as the app does) ended pythonw and children" } else { Add-Result $Phase "engine stop leaves no process ($Tag)" "FAIL" (($left1 | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ExecutablePath }) -join "; ") }

    $p2 = Start-EngineProc $Dir $port $data "$Tag-2" $null
    $secs2 = Wait-Health $url 60
    if ($secs2 -lt 0) { Add-Result $Phase "engine restart over existing data" "FAIL" "no /health after restart"; Stop-Tree $p2.Id; return }
    Add-Result $Phase "engine restart over existing data ($Tag)" "PASS" ("{0} s (normal PATH)" -f $secs2)
    $lost = @(); foreach ($k in $mk.Keys) { if (-not (Test-Path -LiteralPath (Join-Path $dataTasks $k))) { $lost += $k } }
    if (-not (Test-Path -LiteralPath (Join-Path $data "history.jsonl"))) { $lost += "history.jsonl" }
    if ($lost.Count -eq 0) { Add-Result $Phase "user data survives an engine restart / reinstall ($Tag)" "PASS" "input, output, config (also of a mail task), shared\roster\Names.xlsx, shared\roster-reference\*.xlsx and history.jsonl untouched" }
    else { Add-Result $Phase "user data survives an engine restart / reinstall ($Tag)" "FAIL" ("lost: " + ($lost -join ", ")) }
    $notPruned = @($strays | Where-Object { Test-Path -LiteralPath (Join-Path $dataTasks $_) })
    if ($notPruned.Count -eq 0) { Add-Result $Phase "stray non-data files in the working copy are pruned (by design)" "PASS" "so a file dropped next to task code is removed at the next start; keep your files in input/output/config" } else { Add-Result $Phase "stray files pruned" "WARN" ($notPruned -join ", ") }
    Stop-Tree $p2.Id
    [void](Wait-ProcessGone @($p2.Id) 15)

    $snapAfter = Get-TreeSnapshot @($tasks, $eng)
    $pycAfter = Get-PycacheCount @($tasks, $eng)
    if ($snapAfter.Count -eq $snapBefore.Count -and $snapAfter.Bytes -eq $snapBefore.Bytes) { Add-Result $Phase "install folder not written to by the engine ($Tag)" "PASS" ("{0} files, {1} bytes before and after (baseline taken before the self-test); __pycache__ dirs {2} -> {3}" -f $snapAfter.Count, $snapAfter.Bytes, $pycBefore, $pycAfter) }
    else { Add-Result $Phase "install folder not written to by the engine ($Tag)" "FAIL" ("before {0} files/{1} bytes, after {2} files/{3} bytes" -f $snapBefore.Count, $snapBefore.Bytes, $snapAfter.Count, $snapAfter.Bytes) }
    Save-Evidence (Join-Path $env:TEMP "ai-os-tasks-engine.log") "ai-os-tasks-engine.temp.log"
}

# ---------------------------------------------------------------- app lifecycle --------
function New-AppEnv([string]$ExtraEngineUrl) {
    $v = @{
        ELECTRON_RUN_AS_NODE = $null; AI_OS_MODE = $null; AI_OS_PROJECT_DIR = $null; AI_OS_TASKS_PYTHON = $null; AI_OS_TASKS_DATA_DIR = $null
        AI_OS_PMO_INBOX_DIR = $EmptyInbox; AI_OS_AI_PREWARM = "0"; AI_OS_SKIP_TASKS_ENGINE = $null
        AI_OS_TASKS_ENGINE_URL = $(if ($ExtraEngineUrl) { $ExtraEngineUrl } else { $null })
    }
    if (-not $AllowOllamaStart) { $v["AI_OS_AI_AUTOSTART"] = "0" }
    return $v
}

# Starts AI OS.exe and waits until its desktop.log says the Tasks engine is ready.
function Start-App([string]$Dir, [string]$Label, [string]$UserDataDir, [hashtable]$ExtraEnv, [string]$ReadyPattern = 'Tasks engine is ready\.') {
    $exe = Join-Path $Dir "AI OS.exe"
    $cands = @(); if ($UserDataDir) { $cands = @($UserDataDir) } else { $cands = Get-UserDataCandidates }
    $offsets = @{}; foreach ($c in $cands) { $offsets[$c] = Get-FileLen (Join-Path $c "desktop.log") }
    $vars = New-AppEnv $null; if ($ExtraEnv) { foreach ($k in $ExtraEnv.Keys) { $vars[$k] = $ExtraEnv[$k] } }
    $argList = @(); if ($UserDataDir) { $argList += ('--user-data-dir=' + (Quote-Arg $UserDataDir)) }
    $ollamaBefore = Get-OllamaPids
    $Script:tmpProc = $null
    $sw = [Diagnostics.Stopwatch]::StartNew()
    With-Env $vars { if ($argList.Count) { $Script:tmpProc = Start-Process -FilePath $exe -ArgumentList ($argList -join " ") -PassThru -WorkingDirectory $Dir } else { $Script:tmpProc = Start-Process -FilePath $exe -PassThru -WorkingDirectory $Dir } }
    $proc = $Script:tmpProc
    $null = $proc.Handle
    $Script:StartedProcs.Add($proc.Id)
    $h = @{ Proc = $proc; Label = $Label; Dir = $Dir; Ready = $false; Failed = $false; Why = ""; Text = ""; UserData = $null; LogPath = $null; Offset = 0; UiPort = 0; EngineUrl = $null; ReadySecs = -1; OllamaBefore = $ollamaBefore; Window = $false }
    $failPattern = 'AI OS could not start|did not start within|Tasks engine start request failed|could not be started|Live mode \(|exited with code|could not run'
    while ($sw.Elapsed.TotalSeconds -lt $LaunchTimeoutSeconds) {
        Start-Sleep -Milliseconds 500
        foreach ($c in $cands) {
            $lp = Join-Path $c "desktop.log"
            if ((Get-FileLen $lp) -gt $offsets[$c]) { $h.UserData = $c; $h.LogPath = $lp; $h.Offset = $offsets[$c] }
        }
        if ($h.LogPath) {
            $h.Text = Read-FromOffset $h.LogPath $h.Offset
            if ($h.Text -match $ReadyPattern) { $h.Ready = $true; $h.ReadySecs = [math]::Round($sw.Elapsed.TotalSeconds, 1); break }
            if ($h.Text -match $failPattern) { $h.Failed = $true; $h.Why = (($h.Text -split "`r?`n") | Where-Object { $_ -match $failPattern } | Select-Object -First 2) -join " | "; break }
        }
        if ($proc.HasExited) { $h.Failed = $true; $h.Why = "AI OS.exe exited with code $($proc.ExitCode) before the engine was ready"; break }
    }
    if (-not $h.Ready -and -not $h.Failed) { $h.Failed = $true; $h.Why = "not ready after $LaunchTimeoutSeconds s" }
    if ($h.LogPath) { $h.Text = Read-FromOffset $h.LogPath $h.Offset }
    if ($h.Text -match 'next start --hostname 127\.0\.0\.1 --port (?<p>\d+)') { $h.UiPort = [int]$Matches['p'] }
    if ($h.Ready) {
        for ($i = 0; $i -lt 60; $i++) { $proc.Refresh(); if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $h.Window = $true; break }; Start-Sleep -Milliseconds 500 }
    }
    return $h
}

function Stop-App($h, [string]$Phase, [string]$Dir) {
    $proc = $h.Proc
    $pids = @($proc.Id)
    $children = @(Get-ProcsUnder $Dir | ForEach-Object { $_.ProcessId } | Where-Object { -not $Script:OwnEngine -or $_ -ne $Script:OwnEngine.Id })
    $closed = $false
    try { $proc.Refresh(); $closed = $proc.CloseMainWindow() } catch { }
    if (-not $closed) { Invoke-Native "taskkill.exe" @("/PID", "$($proc.Id)", "/T") 15 | Out-Null }
    $exited = $proc.WaitForExit(60000)
    $allGone = Wait-ProcessGone ($pids + $children) 40
    $left = @(Get-ProcsUnder $Dir)
    if ($Script:OwnEngine) { $left = @($left | Where-Object { $_.ProcessId -ne $Script:OwnEngine.Id }) }
    $newOllama = @(Get-OllamaPids | Where-Object { $h.OllamaBefore -notcontains $_ })
    $portsOpen = @()
    if ($h.UiPort -and -not (Test-PortFree $h.UiPort)) { $portsOpen += $h.UiPort }
    if ($h.EngineUrl -and $h.EngineUrl -ne $Script:OwnEngineUrl -and (Test-Health $h.EngineUrl)) { $portsOpen += $h.EngineUrl }
    $detail = ""
    if ($left.Count -gt 0) { $detail += "still running: " + (($left | ForEach-Object { "{0} {1}" -f $_.ProcessId, ($_.ExecutablePath.Substring($Dir.Length)) }) -join "; ") + ". " }
    if ($newOllama.Count -gt 0) { $detail += "new ollama process(es): " + ($newOllama -join ",") + ". " }
    if ($portsOpen.Count -gt 0) { $detail += "still listening: " + ($portsOpen -join ",") + ". " }
    if ($exited -and $allGone -and $left.Count -eq 0 -and $newOllama.Count -eq 0 -and $portsOpen.Count -eq 0) {
        Add-Result $Phase ("graceful quit leaves no AI OS / python / pythonw / ollama process (" + $h.Label + ")") "PASS" "window closed -> main exited -> UI server, engine and runtime stopped; UI and engine ports closed"
    } else {
        Add-Result $Phase ("graceful quit leaves no AI OS / python / pythonw / ollama process (" + $h.Label + ")") "FAIL" ($detail + "main exited=" + $exited)
        foreach ($x in $left) { Stop-Tree $x.ProcessId }
    }
    if ($h.LogPath) { try { Set-Content -LiteralPath (Join-Path $LogsDir ("desktop-" + $h.Label + ".log")) -Value (Read-FromOffset $h.LogPath $h.Offset) -Encoding UTF8 } catch { } }
    $shutdownWarn = if ($h.LogPath) { (Read-FromOffset $h.LogPath $h.Offset) -split "`r?`n" | Where-Object { $_ -match 'Could not request' } | Select-Object -First 2 } else { @() }
    if ($shutdownWarn) { Add-Result $Phase ("quit: clean shutdown requests (" + $h.Label + ")") "WARN" ($shutdownWarn -join " | ") }
}

function Test-AppReady($h, [string]$Phase, [string]$Dir, [bool]$FullChecks) {
    $label = $h.Label
    if ($h.Failed) { Add-Result $Phase ("app starts and the Tasks engine comes up (" + $label + ")") "FAIL" $h.Why; if ($h.LogPath) { Save-Evidence $h.LogPath ("desktop-" + $label + ".log") }; return }
    Add-Result $Phase ("app starts and the Tasks engine comes up (" + $label + ")") "PASS" ("desktop.log: Tasks engine is ready, {0} s after launch" -f $h.ReadySecs)
    $mode = if ($h.Text -match 'Launch mode: (?<m>[a-z-]+)') { $Matches['m'] } else { "?" }
    if ($mode -eq "bundled") { Add-Result $Phase "UI served from the bundled copy (no dev-machine project folder)" "PASS" "Launch mode: bundled" } else { Add-Result $Phase "UI served from the bundled copy" "FAIL" "Launch mode: $mode (AI_OS_MODE or a live-config.json is steering it to a project folder)" }
    $tUi = Get-LogTime $h.Text 'Starting Next\.js'
    $tEng = Get-LogTime $h.Text 'Starting Tasks engine\.'
    $tReady = Get-LogTime $h.Text 'Tasks engine is ready\.'
    if ($tUi -and $tEng -and $tReady) {
        $uiSecs = [math]::Round(($tEng - $tUi).TotalSeconds, 1); $engSecs = [math]::Round(($tReady - $tEng).TotalSeconds, 1)
        $st = "PASS"; $note = ""
        if ($Script:OwnEngineUrl) { $engSecs = 0 }   # engine was started by this script, not by the app: only the UI budget means anything
        if ($uiSecs -ge $UiBudgetSec -or $engSecs -ge $EngineBudgetSec) { $st = "FAIL"; $note = " (the app gives up at the budget and shows 'AI OS could not start')" } elseif ($uiSecs -gt ($UiBudgetSec * 0.6) -or $engSecs -gt ($EngineBudgetSec * 0.6)) { $st = "WARN"; $note = " (over 60% of a budget: a first launch on a slower disk or with a cold antivirus scan could fail)" }
        Add-Result $Phase ("start times against the app's budgets (" + $label + ")") $st ("UI server up in {0} s (budget {1} s), Tasks engine up in {2} s (budget {3} s), total {4} s{5}" -f $uiSecs, $UiBudgetSec, $engSecs, $EngineBudgetSec, $h.ReadySecs, $note)
    }
    if ($h.Window) {
        $h.Proc.Refresh()
        Add-Result $Phase ("main window shown (" + $label + ")") "PASS" ("title '{0}', responding={1}" -f $h.Proc.MainWindowTitle, $h.Proc.Responding)
    } else { Add-Result $Phase ("main window shown (" + $label + ")") "FAIL" "no top-level window within 30 s after the engine was ready" }
    if ($h.UserData) { Add-Result $Phase ("profile folder (" + $label + ")") "INFO" $h.UserData }

    if ($h.UiPort -gt 0) {
        $base = "http://127.0.0.1:$($h.UiPort)"
        try { $r = Invoke-WebRequest -Uri $base -UseBasicParsing -TimeoutSec 20; Add-Result $Phase ("UI server answers (" + $label + ")") "PASS" ("{0} -> HTTP {1}" -f $base, $r.StatusCode) } catch { Add-Result $Phase ("UI server answers (" + $label + ")") "FAIL" $_.Exception.Message }
        try {
            $cfg = Invoke-RestMethod -Uri "$base/api/tasks-engine/config" -TimeoutSec 15
            $h.EngineUrl = $cfg.url
            $tl = @(Invoke-RestMethod -Uri ($cfg.url + "/tasks") -TimeoutSec 20 | ForEach-Object { $_ })
            Add-Result $Phase ("app's engine answers and lists tasks (" + $label + ")") $(if ($tl.Count -eq 6) { "PASS" } else { "FAIL" }) ("{0}: {1} tasks" -f $cfg.url, $tl.Count)
        } catch { Add-Result $Phase ("app's engine answers (" + $label + ")") "FAIL" $_.Exception.Message }
        if ($FullChecks) {
            $engProcs = @(Get-ProcsUnder $Dir | Where-Object { $_.Name -match '^pythonw?\.exe$' })
            if ($engProcs.Count -ge 1 -and ($engProcs | Where-Object { $_.Name -eq "pythonw.exe" })) { Add-Result $Phase "engine runs as the bundled pythonw.exe (no console window)" "PASS" (($engProcs | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ExecutablePath.Substring($Dir.Length) }) -join "; ") }
            else { Add-Result $Phase "engine runs as the bundled pythonw.exe" "WARN" "no pythonw.exe found under the app folder (the app may be using an engine configured elsewhere)" }
            if ($h.UserData) {
                $wc = Join-Path $h.UserData "tasks-engine\tasks\shift-roster\task.json"
                Add-Result $Phase "task data lives in the profile, not the install folder" $(if (Test-Path -LiteralPath $wc) { "PASS" } else { "FAIL" }) $wc
            }
            try {
                $rep = Invoke-RestMethod -Uri "$base/api/setup?fresh=1" -TimeoutSec 90
                foreach ($c in $rep.report.checks) { Add-Result $Phase ("Setup report: " + $c.id + " (" + $label + ")") "INFO" ("{0}{1}: {2}" -f $c.state, $(if ($c.required) { " (required)" } else { "" }), $c.summary) }
                Add-Result $Phase "Setup screen would open by itself at launch" "INFO" ("ready={0}; on a clean laptop Ollama and the model are missing, so it opens: that is expected" -f $rep.report.ready)
                $null = Invoke-RestMethod -Method Post -Uri "$base/api/setup" -ContentType "application/json" -Body '{"action":"run-selftest"}' -TimeoutSec 20
                $state = $null; $sw = [Diagnostics.Stopwatch]::StartNew()
                while ($sw.Elapsed.TotalSeconds -lt 300) {
                    Start-Sleep -Seconds 3
                    $rep2 = Invoke-RestMethod -Uri "$base/api/setup" -TimeoutSec 60
                    $eng = $rep2.report.checks | Where-Object { $_.id -eq "engine" }
                    if ($eng.state -eq "ok" -or $eng.state -eq "missing") { $state = $eng; break }
                }
                if ($state -and $state.state -eq "ok") { Add-Result $Phase "Setup 'Tasks engine' card: the app's own self-test passes" "PASS" ("{0} s; {1}" -f [math]::Round($sw.Elapsed.TotalSeconds, 1), $state.summary) }
                else { Add-Result $Phase "Setup 'Tasks engine' card: the app's own self-test passes" "FAIL" $(if ($state) { ($state.summary + " " + ($state.details -join "; ")) } else { "no result within 300 s" }) }
            } catch { Add-Result $Phase "Setup report / self-test via the app's API" "FAIL" $_.Exception.Message }
        }
    }
}

# ================================================================ MAIN ===================
$ErrorActionPreference = "Continue"
Write-Host ""
Write-Host "AI OS installer check" -ForegroundColor White
Log ("results folder: " + $ResultsDir)
$mode = if ($Installer) { "INSTALL" } elseif ($AppDir) { "DRY (-AppDir, nothing is installed)" } else { "" }
if (-not $mode) { Write-Host "Pass -Installer <AI OS Setup x.y.z.exe> (clean laptop) or -AppDir <unpacked app folder> (dry run)." -ForegroundColor Red; exit 3 }
Log ("mode: " + $mode)

# ---- 0. preflight ------------------------------------------------------------------------
Phase "0. Preflight"
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Result "0 Preflight" "machine" "INFO" ("{0} build {1}, {2}, PowerShell {3}, RAM {4} GB, user '{5}'" -f $os.Caption, $os.BuildNumber, $env:PROCESSOR_ARCHITECTURE, $PSVersionTable.PSVersion, [math]::Round($cs.TotalPhysicalMemory / 1GB), $env:USERNAME)
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { Add-Result "0 Preflight" "CPU architecture" "WARN" "ARM64: the installer is x64-only and runs under emulation (Python/numpy/scipy will be slower; Ollama has an ARM build)" } else { Add-Result "0 Preflight" "CPU architecture" "PASS" $env:PROCESSOR_ARCHITECTURE }
if ([int]$os.BuildNumber -lt 19041) { Add-Result "0 Preflight" "Windows version" "FAIL" "Windows 10 2004 or newer is required by this Electron version" }
if ($isAdmin) { Add-Result "0 Preflight" "running as a normal user" "WARN" "this PowerShell is elevated: a 'no administrator prompt' result would prove nothing. Re-run from a normal window." } else { Add-Result "0 Preflight" "running as a normal user (not elevated)" "PASS" "so any admin requirement of the installer would show up" }
$free = [math]::Round((Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -ErrorAction SilentlyContinue).Free / 1GB, 1)
if ($free -lt 4) { Add-Result "0 Preflight" "free disk space on $($env:SystemDrive)" "FAIL" "$free GB free; the install needs about 1 GB plus the installer and test copies" }
elseif ($free -lt 20) { Add-Result "0 Preflight" "free disk space on $($env:SystemDrive)" "WARN" "$free GB free: enough to install, but the AI model needs about 12 GB more" }
else { Add-Result "0 Preflight" "free disk space on $($env:SystemDrive)" "PASS" "$free GB free" }
try { $mp = Get-MpComputerStatus -ErrorAction Stop; Add-Result "0 Preflight" "Microsoft Defender" "INFO" ("real-time protection: {0}. First launches are slower while it scans the 19,000 new files (see the start-time checks)" -f $mp.RealTimeProtectionEnabled) } catch { Add-Result "0 Preflight" "Microsoft Defender" "INFO" "status not readable (another antivirus or policy)" }
try {
    $sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
    if ($sac -eq 1) { Add-Result "0 Preflight" "Smart App Control" "WARN" "ENFORCED: Windows will block the unsigned installer and the unsigned AI OS.exe with no way to 'run anyway'. It can only be turned off in Windows Security > App & browser control (a one-way switch), or the app must be code-signed." }
    elseif ($sac -eq 2) { Add-Result "0 Preflight" "Smart App Control" "WARN" "EVALUATION mode: it may switch itself on and then block unsigned apps. Check Windows Security > App & browser control." }
    else { Add-Result "0 Preflight" "Smart App Control" "PASS" "off (state $sac)" }
} catch { Add-Result "0 Preflight" "Smart App Control" "INFO" "state not readable" }
try {
    $ci = Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction Stop
    $applocker = Test-Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\SrpV2'
    Add-Result "0 Preflight" "application control (WDAC / AppLocker)" $(if ($ci.UsermodeCodeIntegrityPolicyEnforcementStatus -eq 0 -and -not $applocker) { "PASS" } else { "WARN" }) ("WDAC user-mode enforcement status {0} (0 = off); AppLocker policy present: {1}. If on, unsigned exes in %LOCALAPPDATA% (installer, AI OS.exe, python.exe) may be blocked." -f $ci.UsermodeCodeIntegrityPolicyEnforcementStatus, $applocker)
} catch { Add-Result "0 Preflight" "application control (WDAC / AppLocker)" "INFO" "state not readable" }
$hostile = @()
foreach ($n in "PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONUSERBASE") { foreach ($scope in "Process", "User", "Machine") { $v = [Environment]::GetEnvironmentVariable($n, $scope); if ($v) { $hostile += "$n=$v ($scope)" } } }
if ($hostile.Count -eq 0) { Add-Result "0 Preflight" "no PYTHON* environment variables that would hijack the bundled Python" "PASS" "PYTHONHOME / PYTHONPATH not set" }
else { Add-Result "0 Preflight" "PYTHON* environment variables" "WARN" ("set: " + ($hostile -join "; ") + ". PYTHONHOME or PYTHONPATH are inherited by the Tasks engine and break its imports (verified in the audit).") }
$aiVars = @(); foreach ($n in "AI_OS_MODE", "AI_OS_PROJECT_DIR", "AI_OS_TASKS_PYTHON", "AI_OS_TASKS_DATA_DIR", "AI_OS_TASKS_ENGINE_URL", "AI_OS_TASKS_DIR", "AI_OS_PMO_INBOX_DIR", "AI_OS_SKIP_TASKS_ENGINE", "NEXT_PUBLIC_AGENT_OFFICE_API_URL") { $v = [Environment]::GetEnvironmentVariable($n, "Process"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "User") }; if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Machine") }; if ($v) { $aiVars += "$n=$v" } }
if ($aiVars.Count -eq 0) { Add-Result "0 Preflight" "no AI_OS_* overrides in the environment" "PASS" "a new laptop should have none" } else { Add-Result "0 Preflight" "AI_OS_* overrides set" "WARN" (($aiVars -join "; ") + " (the script clears the dangerous ones for its own launches; a normal Start-menu launch would still see them)") }
$defaultInbox = "C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox"
Add-Result "0 Preflight" "the app's built-in default PMO inbox folder" "INFO" ("hard-coded in the app: {0} -> exists on this machine: {1}. If not, the Setup 'PMO inbox' card asks you to pick the folder." -f $defaultInbox, (Test-Path -LiteralPath $defaultInbox))
$nonAscii = ($env:USERPROFILE -match '[^\x20-\x7E]'); $hasSpace = ($env:USERPROFILE -match ' ')
Add-Result "0 Preflight" "profile path" "INFO" ("{0} (spaces: {1}, non-ASCII: {2}); the install path adds 'AppData\Local\Programs\AI OS' (longest packaged file path is 149 characters, Windows limit 260)" -f $env:USERPROFILE, $hasSpace, $nonAscii)

$existingEntries = @(Get-UninstallEntries)
$installedDirDefault = Join-Path $env:LOCALAPPDATA "Programs\AI OS"
$profileExisted = @(Get-UserDataCandidates | Where-Object { Test-Path -LiteralPath $_ })
$running = @(Get-Process -Name "AI OS" -ErrorAction SilentlyContinue)
if ($Installer) {
    $existing = @()
    if ($existingEntries.Count) { $existing += "uninstall entry: " + (($existingEntries | ForEach-Object { "{0} {1}" -f $_.Hive, $_.Version }) -join ", ") }
    if (Test-Path -LiteralPath $installedDirDefault) { $existing += "folder $installedDirDefault" }
    $regLoc = Get-InstallLocation "HKCU:"; if ($regLoc) { $existing += "registered install folder $regLoc" }
    $regLocM = Get-InstallLocation "HKLM:"; if ($regLocM) { $existing += "all-users install folder $regLocM" }
    if ($profileExisted.Count) { $existing += "profile " + ($profileExisted -join ", ") }
    if ($running.Count) { $existing += "AI OS.exe running (pid " + (($running | ForEach-Object { $_.Id }) -join ",") + ")" }
    if ($existing.Count -gt 0 -and -not $AllowExistingInstall) {
        Add-Result "0 Preflight" "clean machine (no earlier AI OS)" "FAIL" ("found: " + ($existing -join "; ") + ". This script installs and uninstalls AI OS and removes its test profile, which would hit YOUR installed copy and data. Use a clean laptop, or -AppDir for a dry run, or -AllowExistingInstall if you are sure.")
        $Script:Aborted = $true
    } elseif ($existing.Count -gt 0) {
        $LeaveInstalled = $true
        Add-Result "0 Preflight" "clean machine (no earlier AI OS)" "WARN" ("-AllowExistingInstall: " + ($existing -join "; ") + " will be replaced/removed")
    } else { Add-Result "0 Preflight" "clean machine (no earlier AI OS)" "PASS" "no install, no profile folder, no running instance" }
}
$foreign = @(Get-ForeignEngines)
if ($foreign.Count -gt 0 -and $Installer) { Add-Result "0 Preflight" "no other Tasks engine on ports 8000-8019" "FAIL" ("an engine already answers on port(s) " + ($foreign -join ",") + " (an older agent-office, another AI OS, or a leftover pythonw.exe). The app would ADOPT it instead of starting its own, so the test would prove nothing. Quit it and run again (Task Manager > Details > pythonw.exe)."); $Script:Aborted = $true }
elseif ($foreign.Count -gt 0) { Add-Result "0 Preflight" "no other Tasks engine on ports 8000-8019" "WARN" ("an engine already answers on port(s) " + ($foreign -join ",") + ". The app would ADOPT it instead of starting its own; dry-run launch checks use a script-started engine instead (limited coverage).") }
else { Add-Result "0 Preflight" "no other Tasks engine on ports 8000-8019" "PASS" "the app will start its own engine" }

$installerInfo = $null; $matchesAudit = $true
if ($Installer) {
    if (-not (Test-Path -LiteralPath $Installer)) { Add-Result "1 Installer" "installer file" "FAIL" "not found: $Installer"; $Script:Aborted = $true }
    else {
        $Installer = (Resolve-Path -LiteralPath $Installer).Path
        $fi = Get-Item -LiteralPath $Installer
        $sha = Get-Sha256 $Installer
        $installerInfo = @{ Name = $fi.Name; Size = $fi.Length; Sha = $sha }
        Phase "1. Installer file"
        Add-Result "1 Installer" "installer" "INFO" ("{0}, {1:N0} bytes, SHA-256 {2}" -f $fi.Name, $fi.Length, $sha)
        $expectedInst = $null; $ej = Join-Path $DataFolder "expected-installers.json"
        if (Test-Path -LiteralPath $ej) { $expectedInst = (Get-Content -LiteralPath $ej -Raw | ConvertFrom-Json).PSObject.Properties | Where-Object { $_.Name -eq $fi.Name } | Select-Object -First 1 }
        if ($ExpectedSha256) {
            if ($ExpectedSha256.ToLowerInvariant() -eq $sha) { Add-Result "1 Installer" "SHA-256 equals the one you gave" "PASS" "the copy is intact" } else { Add-Result "1 Installer" "SHA-256 equals the one you gave" "FAIL" "different: the file was corrupted in transfer, or it is another build"; $Script:Aborted = $true }
            $matchesAudit = ($expectedInst -and $expectedInst.Value.sha256 -eq $sha)
        } elseif ($expectedInst) {
            if ($expectedInst.Value.sha256 -eq $sha) { Add-Result "1 Installer" "SHA-256 equals the audited build" "PASS" ("{0}: byte-identical to the installer whose payload was audited" -f $fi.Name) }
            else { $matchesAudit = $false; Add-Result "1 Installer" "SHA-256 equals the audited build" "WARN" "different from the audited build: either you rebuilt it (fine; payload comparisons become warnings) or the copy is corrupt. Compare with Get-FileHash on the source machine, or pass -ExpectedSha256." }
        } else { $matchesAudit = $false; Add-Result "1 Installer" "SHA-256 equals the audited build" "INFO" "no audited hash for this file name; pass -ExpectedSha256 <hash from the source machine> to detect a bad copy" }
        try {
            $head = [System.IO.File]::OpenRead($Installer); $buf = New-Object byte[] 600000; $n = $head.Read($buf, 0, $buf.Length); $head.Dispose()
            $txt = [Text.Encoding]::GetEncoding(28591).GetString($buf, 0, $n)
            if ($txt -match 'requestedExecutionLevel level="(?<l>[A-Za-z]+)"') { $lvl = $Matches['l']; Add-Result "1 Installer" "installer needs no administrator rights" $(if ($lvl -eq "asInvoker") { "PASS" } else { "FAIL" }) "embedded manifest: requestedExecutionLevel=$lvl (asInvoker = runs as the current user, no UAC prompt)" }
            else { Add-Result "1 Installer" "installer execution level" "WARN" "manifest not found in the first 600 KB" }
        } catch { Add-Result "1 Installer" "installer manifest" "WARN" $_.Exception.Message }
        $sig = Get-AuthenticodeSignature -LiteralPath $Installer
        Add-Result "1 Installer" "code-signing" "INFO" ("Authenticode: {0}. Unsigned installers show Windows SmartScreen 'unknown publisher' (More info > Run anyway) and may be blocked on a locked-down laptop; this cannot be tested by script." -f $sig.Status)
        $zone = $null; try { $zone = Get-Content -LiteralPath $Installer -Stream Zone.Identifier -ErrorAction Stop } catch { }
        Add-Result "1 Installer" "Mark-of-the-Web" "INFO" $(if ($zone) { "present (downloaded/copied from the internet or a blocked share): SmartScreen will check it. Unblock-File would remove it, but do the manual run with it as is." } else { "not present (copied locally: SmartScreen is unlikely to prompt)" })
    }
    if ($PreviousInstaller -and -not (Test-Path -LiteralPath $PreviousInstaller)) { Add-Result "1 Installer" "previous installer (1.0.0)" "FAIL" "not found: $PreviousInstaller"; $PreviousInstaller = $null }
}

$Script:Refused = $Script:Aborted   # preflight said no: nothing may be installed, uninstalled or deleted
$Script:InstallDir = $null
$Script:UserDataIso = $null
$Script:OwnEngine = $null
$Script:OwnEngineUrl = $null
$createdProfile = $false

try {
    if (-not $Script:Aborted) {
        # ---- 2. install -----------------------------------------------------------------
        if ($Installer) {
            Phase "2. Install (silent, per user)"
            $inst = Invoke-Installer $Installer $null "main"
            $regDir = Get-InstallLocation "HKCU:"
            $Script:InstallDir = $(if ($regDir) { $regDir } else { $installedDirDefault })
            if ($regDir -and ($regDir.TrimEnd('\') -ne $installedDirDefault.TrimEnd('\'))) { Add-Result "2 Install" "default install folder" "WARN" "installed to $regDir instead of $installedDirDefault" }
            if ($inst.TimedOut) { Add-Result "2 Install" "silent install" "FAIL" ("installer still running after {0} min (a dialog is probably waiting: look at the desktop)" -f $InstallTimeoutMinutes) }
            elseif (-not $inst.Ok) { Add-Result "2 Install" "silent install" "FAIL" ("exit code {0} after {1} s" -f $inst.ExitCode, $inst.Secs) }
            else { Add-Result "2 Install" "silent install" $(if (Test-Path -LiteralPath (Join-Path $Script:InstallDir "AI OS.exe")) { "PASS" } else { "FAIL" }) ("exit code 0 in {0} s into {1} (path contains a space)" -f $inst.Secs, $Script:InstallDir) }
            $entries = @(Get-UninstallEntries)
            if ($entries.Count -eq 1 -and $entries[0].Hive -eq "HKCU:") { Add-Result "2 Install" "per-user install (no administrator)" "PASS" ("uninstall entry in HKCU: version {0}, location {1}" -f $entries[0].Version, $entries[0].InstallLocation) }
            elseif ($entries.Count -ge 1) { Add-Result "2 Install" "per-user install (no administrator)" "FAIL" (($entries | ForEach-Object { "{0} {1}" -f $_.Hive, $_.Version }) -join "; ") }
            else { Add-Result "2 Install" "uninstall entry" "FAIL" "no 'AI OS' entry in Apps & features (registry)" }
            $sc = Get-Shortcuts
            foreach ($s in $sc) { Add-Result "2 Install" ("shortcut " + (Split-Path $s.Path -Leaf) + " in " + (Split-Path (Split-Path $s.Path -Parent) -Leaf)) $(if ($s.Exists -and $s.Target -and ($s.Target -like "*AI OS.exe")) { "PASS" } else { "FAIL" }) ("{0} -> {1}" -f $s.Path, $s.Target) }
            if (Test-Path -LiteralPath (Join-Path $Script:InstallDir "Uninstall AI OS.exe")) { Add-Result "2 Install" "uninstaller present" "PASS" "Uninstall AI OS.exe" } else { Add-Result "2 Install" "uninstaller present" "FAIL" "missing" }
            $profileNow = @(Get-UserDataCandidates | Where-Object { Test-Path -LiteralPath $_ })
            Add-Result "2 Install" "installer does not create the profile folder" $(if ($profileNow.Count -eq 0) { "PASS" } else { "INFO" }) $(if ($profileNow.Count -eq 0) { "no %APPDATA%\ai-os yet: the first launch creates it" } else { "exists: " + ($profileNow -join ", ") })
            if (-not (Test-Path -LiteralPath (Join-Path $Script:InstallDir "AI OS.exe"))) { $Script:Aborted = $true }
        } else {
            $Script:InstallDir = (Resolve-Path -LiteralPath $AppDir).Path.TrimEnd('\')
            Phase "2. Payload (dry run on an existing folder)"
            if (-not (Test-Path -LiteralPath (Join-Path $Script:InstallDir "AI OS.exe"))) { Add-Result "2 Install" "app folder" "FAIL" "no AI OS.exe in $AppDir"; $Script:Aborted = $true }
            else {
                Add-Result "2 Install" "app folder" "INFO" ("{0}. NOT installed: no registry entry, shortcuts, uninstall, reinstall or upgrade checks in this mode." -f $Script:InstallDir)
                try { $kj = Join-Path $DataFolder "expected-keyfiles-2.0.0.json"; $matchesAudit = ((Get-Sha256 (Join-Path $Script:InstallDir "AI OS.exe")) -eq ((Get-Content -LiteralPath $kj -Raw | ConvertFrom-Json).key_sha256.'AI OS.exe')) } catch { $matchesAudit = $false }
                Add-Result "2 Install" "app folder is the audited 2.0.0 build" "INFO" ("AI OS.exe hash equals the audited one: {0} (if false, payload differences are warnings, not failures)" -f $matchesAudit)
            }
        }
    }

    if (-not $Script:Aborted) {
        $dir = $Script:InstallDir
        Test-Payload $dir "2 Install" $matchesAudit

        # ---- 3. engine ------------------------------------------------------------------
        Phase "3. Bundled Python and Tasks engine (empty PATH, no installed Python needed)"
        Test-EngineStandalone $dir "3 Engine" "install"

        # ---- 4..7 app lifecycle ---------------------------------------------------------
        if ($SkipLaunch) { Add-Result "4 Launch" "app launch checks" "SKIP" "-SkipLaunch" }
        else {
            $ud = $null; $extra = @{}
            if (-not $Installer) {
                $ud = Join-Path $ResultsDir "userdata"; New-Item -ItemType Directory -Force -Path $ud | Out-Null
                $Script:UserDataIso = $ud
            } else { $createdProfile = ($profileExisted.Count -eq 0) }
            if ($foreign.Count -gt 0) {
                $p = Get-FreePort 8187 8199
                $ownData = Join-Path $ResultsDir "engine-data-launch"
                $Script:OwnEngine = Start-EngineProc $dir $p $ownData "launch" $null
                $Script:OwnEngineUrl = "http://127.0.0.1:$p"
                if ((Wait-Health $Script:OwnEngineUrl 60) -lt 0) { Add-Result "4 Launch" "own engine for the dry run" "FAIL" "did not start" }
                else { $extra["AI_OS_TASKS_ENGINE_URL"] = $Script:OwnEngineUrl; Add-Result "4 Launch" "launch checks use a script-started engine" "WARN" ("a foreign engine owns 8000-8019, so the app is pointed at the script's engine on port {0}: the app's own 'start the engine' path, quit-stops-engine and the engine-ready time are NOT exercised" -f $p) }
            }

            Phase "4. First launch of the real app"
            $h1 = Start-App $dir "first-launch" $ud $extra
            Test-AppReady $h1 "4 Launch" $dir ($foreign.Count -eq 0)
            if ($h1.UserData -and $foreign.Count -eq 0) {
                $wcRoot = Join-Path $h1.UserData "tasks-engine\tasks\shift-roster"
                foreach ($sub in "input", "output", "config") { if (Test-Path -LiteralPath $wcRoot) { Set-Content -LiteralPath (Join-Path $wcRoot "$sub\_aios_firstrun_marker.txt") -Value "marker" -Encoding ASCII -ErrorAction SilentlyContinue } }
            }

            if ($h1.Ready) {
                Phase "5. Second launch while the app is running (single instance)"
                $before = @(Get-ProcsUnder $dir).Count
                $second = $null; $Script:tmpProc = $null
                $a2 = @(); if ($ud) { $a2 += ('--user-data-dir=' + (Quote-Arg $ud)) }
                With-Env (New-AppEnv $Script:OwnEngineUrl) { if ($a2.Count) { $Script:tmpProc = Start-Process -FilePath (Join-Path $dir "AI OS.exe") -ArgumentList ($a2 -join " ") -PassThru } else { $Script:tmpProc = Start-Process -FilePath (Join-Path $dir "AI OS.exe") -PassThru } }
                $second = $Script:tmpProc; $null = $second.Handle
                $ended = $second.WaitForExit(30000)
                if ($ended) { Add-Result "5 Second launch" "second AI OS.exe exits at once" "PASS" ("exit code {0}; the running instance is brought to the front instead" -f $second.ExitCode) } else { Add-Result "5 Second launch" "second AI OS.exe exits at once" "FAIL" "still running after 30 s (two instances?)"; Stop-Tree $second.Id }
                $h1.Proc.Refresh()
                Add-Result "5 Second launch" "first instance unaffected" $(if (-not $h1.Proc.HasExited -and $h1.Proc.Responding) { "PASS" } else { "FAIL" }) ("running={0}, responding={1}; engines on 8000-8019 after: {2}" -f (-not $h1.Proc.HasExited), $h1.Proc.Responding, ((Get-ForeignEngines) -join ","))

                Phase "6. Graceful quit"
                Stop-App $h1 "6 Quit" $dir

                Phase "7. Launch again (data from the first run, restart time)"
                $h2 = Start-App $dir "relaunch" $ud $extra
                Test-AppReady $h2 "7 Relaunch" $dir $false
                if ($h2.UserData -and $foreign.Count -eq 0) {
                    $m = Join-Path $h2.UserData "tasks-engine\tasks\shift-roster\input\_aios_firstrun_marker.txt"
                    Add-Result "7 Relaunch" "task data from the first run survives a restart" $(if (Test-Path -LiteralPath $m) { "PASS" } else { "FAIL" }) $m
                }
                if ($h2.Ready -and $h1.ReadySecs -gt 0) { Add-Result "7 Relaunch" "restart is not slower than first launch" "INFO" ("first {0} s, second {1} s" -f $h1.ReadySecs, $h2.ReadySecs) }
                Stop-App $h2 "7 Relaunch" $dir
            } else { Stop-App $h1 "6 Quit" $dir }
            if ($Script:OwnEngine) { Stop-Tree $Script:OwnEngine.Id; $Script:OwnEngine = $null }
        }

        # ---- 8..11 installer scenarios -------------------------------------------------------
        if ($Installer) {
            Phase "8. Reinstall over the top"
            $prof = $null
            foreach ($c in Get-UserDataCandidates) { if (Test-Path -LiteralPath (Join-Path $c "tasks-engine")) { $prof = $c } }
            $markers = @()
            if ($prof) {
                foreach ($sub in "input", "output", "config") {
                    $mp = Join-Path $prof "tasks-engine\tasks\shift-roster\$sub\_aios_reinstall_marker.txt"
                    try { Set-Content -LiteralPath $mp -Value "keep me" -Encoding ASCII; $markers += $mp } catch { }
                }
                $logBefore = Get-FileLen (Join-Path $prof "desktop.log")
            } else { Add-Result "8 Reinstall" "profile to protect" "WARN" "no tasks-engine folder in the profile (the app never ran?): data-retention check limited" }
            $re = Invoke-Installer $Installer $null "reinstall"
            Add-Result "8 Reinstall" "installer over an existing install (app closed)" $(if ($re.Ok) { "PASS" } else { "FAIL" }) ("exit {0} in {1} s" -f $re.ExitCode, $re.Secs)
            $lostM = @($markers | Where-Object { -not (Test-Path -LiteralPath $_) })
            if ($markers.Count) { Add-Result "8 Reinstall" "user data survives a reinstall (input, output, config)" $(if ($lostM.Count -eq 0) { "PASS" } else { "FAIL" }) $(if ($lostM.Count -eq 0) { "{0} marker files in the profile still there" -f $markers.Count } else { "lost: " + ($lostM -join "; ") }) }
            if ($prof) { Add-Result "8 Reinstall" "desktop.log kept" $(if ((Get-FileLen (Join-Path $prof "desktop.log")) -ge $logBefore) { "PASS" } else { "FAIL" }) "profile log not truncated" }
            $e2 = @(Get-UninstallEntries); Add-Result "8 Reinstall" "single uninstall entry" $(if ($e2.Count -eq 1) { "PASS" } else { "FAIL" }) ("{0} entr(y/ies)" -f $e2.Count)
            Test-Payload $Script:InstallDir "8 Reinstall" $matchesAudit
            $sc2 = Get-Shortcuts; $bad = @($sc2 | Where-Object { -not $_.Exists }); Add-Result "8 Reinstall" "shortcuts after reinstall" $(if ($bad.Count -eq 0) { "PASS" } else { "FAIL" }) (($sc2 | ForEach-Object { (Split-Path $_.Path -Leaf) + "=" + $_.Exists }) -join ", ")
            if (-not $SkipLaunch) {
                $h3 = Start-App $Script:InstallDir "after-reinstall" $null @{}
                Test-AppReady $h3 "8 Reinstall" $Script:InstallDir $false
                if ($h3.UserData) { $survive = @($markers | Where-Object { Test-Path -LiteralPath $_ }).Count; Add-Result "8 Reinstall" "app starts on the retained data" $(if ($h3.Ready) { "PASS" } else { "FAIL" }) ("{0} markers still present after the app synced the working copy" -f $survive) }
                if (-not $Quick -and $h3.Ready) {
                    Phase "8b. Installer run while AI OS is RUNNING"
                    $enginePids = @(Get-ProcsUnder $Script:InstallDir | Where-Object { $_.Name -like "python*" } | ForEach-Object { $_.ProcessId })
                    $re2 = Invoke-Installer $Installer $null "reinstall-running"
                    Add-Result "8b Running" "installer closes the running app and completes" $(if ($re2.Ok) { "PASS" } else { "FAIL" }) ("exit {0} in {1} s{2}" -f $re2.ExitCode, $re2.Secs, $(if ($re2.TimedOut) { " (hung: a 'file in use' or 'close the app' dialog is probably open)" } else { "" }))
                    $orph = @(Get-ProcsUnder $Script:InstallDir)
                    if ($orph.Count -eq 0) { Add-Result "8b Running" "no orphaned engine after the installer killed the app" "PASS" "nothing left running from the install folder" }
                    else { Add-Result "8b Running" "no orphaned engine after the installer killed the app" "FAIL" (($orph | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ExecutablePath }) -join "; ") + " (the installer ends 'AI OS.exe' by name; pythonw.exe has another name and can stay alive and lock python files)"; foreach ($o in $orph) { Stop-Tree $o.ProcessId } }
                    Test-Payload $Script:InstallDir "8b Running" $matchesAudit
                    $h4 = Start-App $Script:InstallDir "after-reinstall-while-running" $null @{}
                    Test-AppReady $h4 "8b Running" $Script:InstallDir $false
                    Stop-App $h4 "8b Running" $Script:InstallDir
                } else { Stop-App $h3 "8 Reinstall" $Script:InstallDir }
            }

            Phase "9. Uninstall"
            $prof9 = $null; foreach ($c in Get-UserDataCandidates) { if (Test-Path -LiteralPath (Join-Path $c "tasks-engine")) { $prof9 = $c } }
            $un = Invoke-Uninstaller $Script:InstallDir
            if (-not $un.Ok) { Add-Result "9 Uninstall" "silent uninstall" "FAIL" $un.Note }
            else {
                $left9 = Test-Path -LiteralPath $Script:InstallDir
                $leftFiles = 0; if ($left9) { $leftFiles = @(Get-ChildItem -LiteralPath $Script:InstallDir -Recurse -File -Force -ErrorAction SilentlyContinue).Count }
                Add-Result "9 Uninstall" "install folder removed" $(if (-not $left9 -or $leftFiles -eq 0) { "PASS" } else { "FAIL" }) ("{0} s; {1}" -f $un.Secs, $(if ($left9) { "$leftFiles files remain" } else { "folder gone" }))
                $e9 = @(Get-UninstallEntries); Add-Result "9 Uninstall" "Apps & features entry removed" $(if ($e9.Count -eq 0) { "PASS" } else { "FAIL" }) ("{0} entr(y/ies) left" -f $e9.Count)
                $sc9 = @(Get-Shortcuts | Where-Object { $_.Exists }); Add-Result "9 Uninstall" "shortcuts removed" $(if ($sc9.Count -eq 0) { "PASS" } else { "FAIL" }) $(if ($sc9.Count) { ($sc9 | ForEach-Object { $_.Path }) -join ", " } else { "desktop and Start menu" })
                if ($prof9) { Add-Result "9 Uninstall" "user data kept after uninstall (design: deleteAppDataOnUninstall is off)" $(if (Test-Path -LiteralPath (Join-Path $prof9 "tasks-engine")) { "PASS" } else { "WARN" }) ("{0}: task data, PMO data and desktop.log stay so a reinstall continues where you left off; delete the folder by hand for a full wipe, or run the uninstaller with --delete-app-data" -f $prof9) }
                $rest = @(Get-Process -Name "AI OS" -ErrorAction SilentlyContinue); Add-Result "9 Uninstall" "no AI OS process left" $(if ($rest.Count -eq 0) { "PASS" } else { "FAIL" }) ("{0} running" -f $rest.Count)
            }

            if (-not $Quick) {
                Phase "10. Install under a path with spaces and a non-ASCII letter"
                $custom = Join-Path $env:USERPROFILE ("AI OS " + [char]0x00FC + "ber test dir\AI OS")
                $c1 = Invoke-Installer $Installer $custom "custom"
                $okc = (-not $c1.TimedOut) -and $c1.Ok -and (Test-Path -LiteralPath (Join-Path $custom "AI OS.exe"))
                Add-Result "10 Custom path" "install to a custom folder" $(if ($okc) { "PASS" } else { "FAIL" }) ("{0} (exit {1}, {2} s)" -f $custom, $c1.ExitCode, $c1.Secs)
                if ($okc) {
                    Test-Payload $custom "10 Custom path" $matchesAudit
                    Test-EngineStandalone $custom "10 Custom path" "custom"
                    if (-not $SkipLaunch) { $h5 = Start-App $custom "custom-path" $null @{}; Test-AppReady $h5 "10 Custom path" $custom $false; Stop-App $h5 "10 Custom path" $custom }
                    $un2 = Invoke-Uninstaller $custom
                    Add-Result "10 Custom path" "uninstall from the custom folder" $(if (-not (Test-Path -LiteralPath (Join-Path $custom "AI OS.exe"))) { "PASS" } else { "FAIL" }) ("{0} s" -f $un2.Secs)
                    try { Remove-Item -LiteralPath (Split-Path $custom -Parent) -Recurse -Force -ErrorAction SilentlyContinue } catch { }
                }
            }

            if ($PreviousInstaller -and -not $Quick) {
                Phase "11. Upgrade over 1.0.0"
                if ($createdProfile) { foreach ($c in Get-UserDataCandidates) { if (Test-Path -LiteralPath $c) { try { Remove-Item -LiteralPath $c -Recurse -Force -ErrorAction Stop } catch { } } } }   # start 1.0.0 from an empty profile so the upgrade test sees only 1.0.0's own data
                $pi = Invoke-Installer $PreviousInstaller $null "previous"
                Add-Result "11 Upgrade" "1.0.0 installs" $(if ($pi.Ok) { "PASS" } else { "FAIL" }) ("exit {0}, {1} s" -f $pi.ExitCode, $pi.Secs)
                if ($pi.Ok -and -not $SkipLaunch) {
                    $oldDir = $installedDirDefault
                    # 1.0.0 needs an external agent-office engine; AI_OS_SKIP_AGENT_OFFICE=1 (its own test switch) skips it.
                    # It is "ready" when its log says so, then its window shows.
                    $o1 = Start-App $oldDir "v1-0-0" $null @{ AI_OS_SKIP_AGENT_OFFICE = "1" } 'not starting Agent Office'
                    $o1.Proc.Refresh()
                    $oldProfile = $o1.UserData
                    Add-Result "11 Upgrade" "1.0.0 launched (agent-office skipped) and wrote its profile" $(if ($oldProfile -and $o1.Ready) { "PASS" } else { "WARN" }) ("window={0}, profile={1}" -f ($o1.Proc.MainWindowHandle -ne [IntPtr]::Zero), $oldProfile)
                    if ($oldProfile) { Set-Content -LiteralPath (Join-Path $oldProfile "_aios_upgrade_marker.txt") -Value "from 1.0.0" -Encoding ASCII }
                    $closed = $false; try { $closed = $o1.Proc.CloseMainWindow() } catch { }
                    if (-not $o1.Proc.WaitForExit(30000)) { Stop-Tree $o1.Proc.Id }
                    foreach ($x in (Get-ProcsUnder $oldDir)) { Stop-Tree $x.ProcessId }
                }
                $up = Invoke-Installer $Installer $null "upgrade"
                Add-Result "11 Upgrade" "2.0.0 installs over 1.0.0" $(if ($up.Ok) { "PASS" } else { "FAIL" }) ("exit {0}, {1} s" -f $up.ExitCode, $up.Secs)
                $eu = @(Get-UninstallEntries); Add-Result "11 Upgrade" "one entry, new version" $(if ($eu.Count -eq 1 -and $eu[0].Version -like "2.*") { "PASS" } else { "FAIL" }) (($eu | ForEach-Object { "{0} {1}" -f $_.Hive, $_.Version }) -join "; ")
                Test-Payload $installedDirDefault "11 Upgrade" $matchesAudit
                $oldProfile2 = $null; foreach ($c in Get-UserDataCandidates) { if (Test-Path -LiteralPath (Join-Path $c "_aios_upgrade_marker.txt")) { $oldProfile2 = $c } }
                Add-Result "11 Upgrade" "1.0.0 profile data survives the upgrade" $(if ($oldProfile2) { "PASS" } else { "WARN" }) $(if ($oldProfile2) { "marker written by 1.0.0 still in $oldProfile2" } else { "marker not found (1.0.0 did not run, or data was removed)" })
                if (-not $SkipLaunch) {
                    $h6 = Start-App $installedDirDefault "after-upgrade" $null @{}
                    Test-AppReady $h6 "11 Upgrade" $installedDirDefault $true
                    Stop-App $h6 "11 Upgrade" $installedDirDefault
                }
                Add-Result "11 Upgrade" "old agent-office task data" "INFO" "1.0.0 used an external agent-office engine; its task folders are NOT imported by 2.0.0. Copy config/input/output by hand (MANUAL-CHECKLIST.md, 'Move your data')."
                [void](Invoke-Uninstaller $installedDirDefault)
            } elseif (-not $PreviousInstaller) { Add-Result "11 Upgrade" "upgrade over 1.0.0" "SKIP" "pass -PreviousInstaller 'AI OS Setup 1.0.0.exe' to test it" }
        } else {
            Add-Result "8-11" "reinstall, running-app reinstall, uninstall, custom path, upgrade" "SKIP" "dry run (-AppDir): only possible with -Installer on a clean machine"
        }
    }
} finally {
    # ---- cleanup ----------------------------------------------------------------------------
    Phase "Cleanup"
    foreach ($id in $Script:StartedProcs) { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Stop-Tree $id } }
    if ($Script:OwnEngine) { Stop-Tree $Script:OwnEngine.Id }
    if ($Script:InstallDir -and $AppDir) { foreach ($x in (Get-ProcsUnder $Script:InstallDir)) { Stop-Tree $x.ProcessId } }
    if ($Installer -and -not $Script:Refused) {
        foreach ($x in (Get-ProcsUnder $installedDirDefault)) { Stop-Tree $x.ProcessId }
        if (Test-Path -LiteralPath (Join-Path $installedDirDefault "Uninstall AI OS.exe")) { [void](Invoke-Uninstaller $installedDirDefault) }
        if (-not $KeepTestData -and $createdProfile) {
            foreach ($c in Get-UserDataCandidates) { if (Test-Path -LiteralPath $c) { try { Remove-Item -LiteralPath $c -Recurse -Force -ErrorAction Stop; Log "removed test profile $c" } catch { Log ("could not remove {0}: {1}" -f $c, $_.Exception.Message) } } }
        } elseif ($profileExisted.Count -gt 0) { Log "profile folders existed before the run and were not removed" }
        if ($LeaveInstalled) {
            $fin = Invoke-Installer $Installer $null "final"
            Add-Result "Cleanup" "left a pristine AI OS installed (never launched) for the manual checklist" $(if ($fin.Ok) { "INFO" } else { "FAIL" }) ("exit {0}" -f $fin.ExitCode)
        } else { Add-Result "Cleanup" "machine restored" "INFO" "AI OS uninstalled and test profile removed; run the installer by hand for the manual checklist (or re-run with -LeaveInstalled)" }
    }
    Save-Evidence (Join-Path $env:TEMP "ai-os-tasks-engine.log") "ai-os-tasks-engine.temp.log"
    $left = @(); if ($Script:InstallDir) { $left = @(Get-ProcsUnder $Script:InstallDir) }
    if ($left.Count -gt 0) { Add-Result "Cleanup" "stray processes" "WARN" (($left | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ExecutablePath }) -join "; ") }

    # ---- results ------------------------------------------------------------------------------
    $fails = @($Results | Where-Object { $_.status -eq "FAIL" }); $warns = @($Results | Where-Object { $_.status -eq "WARN" })
    $passes = @($Results | Where-Object { $_.status -eq "PASS" })
    $verdict = if ($Script:Refused) { "NOT RUN (preflight refused)" } elseif ($fails.Count -eq 0) { "PASS" } else { "FAIL" }
    $meta = [ordered]@{
        tool = "Run-InstallerCheck.ps1"; started = $StartedAt.ToString("o"); finished = (Get-Date).ToString("o"); mode = $mode
        machine = $env:COMPUTERNAME; user = $env:USERNAME; installer = $installerInfo; appDir = $AppDir; installDir = $Script:InstallDir
        counts = [ordered]@{ pass = $passes.Count; fail = $fails.Count; warn = $warns.Count; total = $Results.Count }; verdict = $verdict
    }
    $json = [ordered]@{ meta = $meta; results = $Results } | ConvertTo-Json -Depth 6
    Set-Content -LiteralPath (Join-Path $ResultsDir "results.json") -Value $json -Encoding UTF8
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("# AI OS installer check - $verdict")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine(("Mode: {0}. Machine: {1} ({2}). Started {3}. PASS {4}, FAIL {5}, WARN {6}." -f $mode, $env:COMPUTERNAME, $env:USERNAME, $StartedAt.ToString("yyyy-MM-dd HH:mm"), $passes.Count, $fails.Count, $warns.Count))
    if ($installerInfo) { [void]$sb.AppendLine(("Installer: {0} ({1:N0} bytes) SHA-256 {2}" -f $installerInfo.Name, $installerInfo.Size, $installerInfo.Sha)) }
    [void]$sb.AppendLine("")
    if ($fails.Count) { [void]$sb.AppendLine("## Failures"); foreach ($f in $fails) { [void]$sb.AppendLine(("- **{0} / {1}**: {2}" -f $f.phase, $f.check, $f.detail)) }; [void]$sb.AppendLine("") }
    if ($warns.Count) { [void]$sb.AppendLine("## Warnings"); foreach ($f in $warns) { [void]$sb.AppendLine(("- {0} / {1}: {2}" -f $f.phase, $f.check, $f.detail)) }; [void]$sb.AppendLine("") }
    [void]$sb.AppendLine("## All checks")
    $phaseOrder = @($Results | ForEach-Object { $_.phase } | Select-Object -Unique)
    foreach ($ph in $phaseOrder) {
        [void]$sb.AppendLine(""); [void]$sb.AppendLine("### $ph"); [void]$sb.AppendLine(""); [void]$sb.AppendLine("| Status | Check | Detail |"); [void]$sb.AppendLine("|---|---|---|")
        foreach ($r in ($Results | Where-Object { $_.phase -eq $ph })) { [void]$sb.AppendLine(("| {0} | {1} | {2} |" -f $r.status, ($r.check -replace '\|', '/'), (($r.detail -replace '\|', '/') -replace "`r?`n", ' '))) }
    }
    [void]$sb.AppendLine(""); [void]$sb.AppendLine("Logs: $LogsDir (desktop.log copies, engine logs, self-test output). Not covered by this script: see MANUAL-CHECKLIST.md.")
    Set-Content -LiteralPath (Join-Path $ResultsDir "results.md") -Value $sb.ToString() -Encoding UTF8
    Write-Host ""
    Write-Host ("VERDICT: {0}   PASS {1}  FAIL {2}  WARN {3}" -f $verdict, $passes.Count, $fails.Count, $warns.Count) -ForegroundColor $(if ($fails.Count -eq 0) { "Green" } else { "Red" })
    Write-Host ("Results: {0}\results.md and results.json" -f $ResultsDir)
}
if ($Script:Refused) { exit 3 }
exit $(if (@($Results | Where-Object { $_.status -eq "FAIL" }).Count -eq 0) { 0 } else { 1 })
