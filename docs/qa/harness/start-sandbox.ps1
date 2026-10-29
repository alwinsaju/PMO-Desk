<#
QA harness - host side. Writes a .wsb and starts Windows Sandbox with the guest agent.
Maps (nothing else from the host is visible in the sandbox):
  C:\Installer  <- -InstallerDir   read-only   (staged copies of the installers, never release\)
  C:\Harness    <- docs\qa\harness read-only   (this folder: guest agent + CDP drivers)
  C:\Results    <- -ResultsDir     read-write  (docs\qa\evidence\sandbox-run-N)
Usage: .\start-sandbox.ps1 -InstallerDir <stage dir> -ResultsDir <docs\qa\evidence\sandbox-run-N> [-MemoryMB 16384]
#>
param(
    [Parameter(Mandatory = $true)][string]$InstallerDir,
    [Parameter(Mandatory = $true)][string]$ResultsDir,
    [string]$ExtraReadOnlyDir,
    [int]$MemoryMB = 16384,
    [switch]$NoNetwork
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$ResultsDir = (Resolve-Path $ResultsDir).Path
$InstallerDir = (Resolve-Path $InstallerDir).Path
$harness = $PSScriptRoot
$net = if ($NoNetwork) { "Disable" } else { "Enable" }
$extra = ""
if ($ExtraReadOnlyDir) { $extra = "<MappedFolder><HostFolder>$((Resolve-Path $ExtraReadOnlyDir).Path)</HostFolder><SandboxFolder>C:\Extra</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>" }
$logon = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File C:\Harness\guest-agent.ps1"
$cfg = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>$net</Networking>
  <MemoryInMB>$MemoryMB</MemoryInMB>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <MappedFolders>
    <MappedFolder><HostFolder>$InstallerDir</HostFolder><SandboxFolder>C:\Installer</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$harness</HostFolder><SandboxFolder>C:\Harness</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$ResultsDir</HostFolder><SandboxFolder>C:\Results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
    $extra
  </MappedFolders>
  <LogonCommand><Command>$([System.Security.SecurityElement]::Escape($logon))</Command></LogonCommand>
</Configuration>
"@
New-Item -ItemType Directory -Force -Path (Join-Path $ResultsDir "cmd") | Out-Null
$wsb = Join-Path $ResultsDir "qa.wsb"
Set-Content -Path $wsb -Value $cfg -Encoding UTF8
Write-Host "Starting sandbox from $wsb"
Start-Process $wsb
