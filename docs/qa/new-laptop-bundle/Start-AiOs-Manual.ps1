<#
.SYNOPSIS
  Starts the INSTALLED AI OS for the manual checklist, with the PMO inbox pointed at an
  empty folder so a first launch cannot move real messages out of your OneDrive PMO-Inbox.

  .\Start-AiOs-Manual.ps1              safe: empty inbox (use for every manual step except step 7)
  .\Start-AiOs-Manual.ps1 -RealInbox   normal behaviour (the real PMO inbox is read and emptied by AI OS)
  .\Start-AiOs-Manual.ps1 -Tail        also show the app's desktop.log lines as it starts

  Nothing else is changed: Ollama is NOT blocked (the manual checklist tests it), no data folder is
  redirected, so this is a normal first launch apart from the inbox.
#>
param([switch]$RealInbox, [switch]$Tail)
$guid = "3dec7c8f-642f-5dc8-a98d-cee7af750c97"
$dir = $null
foreach ($hive in "HKCU:", "HKLM:") {
    $k = "$hive\Software\$guid"
    if (Test-Path $k) { $v = (Get-ItemProperty -LiteralPath $k).InstallLocation; if ($v) { $dir = $v; break } }
}
if (-not $dir) { $dir = Join-Path $env:LOCALAPPDATA "Programs\AI OS" }
$exe = Join-Path $dir "AI OS.exe"
if (-not (Test-Path -LiteralPath $exe)) { Write-Host "AI OS is not installed (no $exe). Run the installer first." -ForegroundColor Red; exit 1 }
$vars = @{ ELECTRON_RUN_AS_NODE = $null }
if (-not $RealInbox) {
    $inbox = Join-Path $env:TEMP "aios-empty-pmo-inbox"
    New-Item -ItemType Directory -Force -Path $inbox | Out-Null
    $vars["AI_OS_PMO_INBOX_DIR"] = $inbox
    Write-Host "PMO inbox redirected to an empty folder: $inbox" -ForegroundColor Yellow
} else { Write-Host "REAL PMO inbox in use: AI OS will read and remove messages from it." -ForegroundColor Red }
$log = $null
foreach ($c in "ai-os", "AI OS") { $p = Join-Path $env:APPDATA "$c\desktop.log"; if (Test-Path $p) { $log = $p } }
$before = 0; if ($log) { $before = (Get-Item $log).Length }
$saved = @{}
foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process"); [Environment]::SetEnvironmentVariable($k, $vars[$k], "Process") }
try { $p = Start-Process -FilePath $exe -PassThru } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process") } }
Write-Host ("Started AI OS (pid {0}) from {1}" -f $p.Id, $dir)
if ($Tail) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt 120) {
        Start-Sleep -Seconds 2
        foreach ($c in "ai-os", "AI OS") {
            $lp = Join-Path $env:APPDATA "$c\desktop.log"
            if (Test-Path $lp) {
                $len = (Get-Item $lp).Length
                if ($len -gt $before) {
                    $fs = [IO.File]::Open($lp, 'Open', 'Read', 'ReadWrite'); $null = $fs.Seek($before, 'Begin'); $sr = New-Object IO.StreamReader($fs); $txt = $sr.ReadToEnd(); $fs.Dispose()
                    Write-Host $txt -NoNewline; $before = $len
                    if ($txt -match "Tasks engine is ready|could not start|did not start") { return }
                }
            }
        }
    }
}
