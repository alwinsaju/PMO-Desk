<#
QA harness - HOST run (owner-approved replacement for Windows Sandbox, which MDM policy blocks).
Launches a COPY of release\win-unpacked with a throw-away profile and every data location redirected into
the scratch root. Never launches the installed app. Refuses to start if the ports/instance checks fail.

  .\host-launch.ps1 -Root <scratch\host> -Port 9333 [-DeadOllama] [-Stub 1] [-StubDelayMs 1500] [-ExtraArgs @()]

Writes <Root>\run.json with the PIDs it started. host-stop.ps1 kills everything under <Root>\app.
#>
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [int]$Port = 9333,
    [switch]$DeadOllama,
    [string]$Stub = "1",
    [int]$StubDelayMs = 1500,
    [string]$Profile = "userdata",
    [string]$DataRoot = "",
    [string[]]$ExtraArgs = @()
)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$exe = Join-Path $Root "app\AI OS.exe"
if (-not (Test-Path $exe)) { throw "no copy at $exe" }
if ($exe -like "*\Programs\AI OS\*") { throw "refusing: installed app" }

# 1. nothing of ours or the installed app running; ports free (8005 is a known System/HTTP.sys listener)
$running = Get-Process -Name "AI OS" -ErrorAction SilentlyContinue
if ($running) { throw "an 'AI OS' process is already running (pid $($running.Id -join ',')); not touching it" }
$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 3100 -or $_.LocalPort -eq $Port -or ($_.LocalPort -ge 8000 -and $_.LocalPort -le 8019 -and $_.LocalPort -ne 8005) }
if ($busy) { throw "ports busy: $(($busy | ForEach-Object { $_.LocalPort }) -join ',')" }

# 2. isolation
if (-not $DataRoot) { $DataRoot = $Root }
New-Item -ItemType Directory -Force $DataRoot | Out-Null
$inbox = Join-Path $DataRoot "inbox"; $tasks = Join-Path $DataRoot "tasks-data"; $ud = Join-Path $DataRoot $Profile
foreach ($d in $inbox, $tasks, $ud) { New-Item -ItemType Directory -Force $d | Out-Null }
$env:AI_OS_PMO_INBOX_DIR = $inbox
$env:AI_OS_PMO_DATA_DIR = (Join-Path $DataRoot "pmo-data")
$env:AI_OS_TASKS_DATA_DIR = $tasks
$env:AI_OS_AI_AUTOSTART = "0"
$env:AI_OS_AI_PREWARM = "0"
$env:AI_OS_PMO_SCAN_MS = "4000"
if ($Stub -eq "1") { $env:PMO_AI_STUB = "1"; $env:PMO_AI_STUB_DELAY_MS = "$StubDelayMs" } else { Remove-Item Env:\PMO_AI_STUB -ErrorAction SilentlyContinue }
if ($DeadOllama) { $env:OLLAMA_BASE_URL = "http://127.0.0.1:11999" } else { Remove-Item Env:\OLLAMA_BASE_URL -ErrorAction SilentlyContinue }
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$args_ = @("--remote-debugging-port=$Port", "--user-data-dir=`"$ud`"") + $ExtraArgs
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $exe -ArgumentList $args_ -PassThru -WorkingDirectory (Join-Path $Root "app")
@{ pid = $p.Id; port = $Port; started = (Get-Date -Format o); profile = $ud; inbox = $inbox; tasks = $tasks } | ConvertTo-Json | Set-Content (Join-Path $Root "run.json")
"started pid $($p.Id); CDP port $Port; userData $ud"

