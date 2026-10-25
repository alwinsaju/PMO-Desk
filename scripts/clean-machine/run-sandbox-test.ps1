<#
Runs the clean-machine check in Windows Sandbox: a throw-away Windows with none of
this machine's software, settings, OneDrive or Outlook. Needs the Windows Sandbox
feature (Windows 10/11 Pro, Enterprise or Education; Settings > Optional features >
"Windows Sandbox", then a restart). Nothing in the sandbox can reach this machine's
files except the two folders mapped below (the installer, read-only; the results,
writable).

  .\run-sandbox-test.ps1 -InstallerDir "C:\Users\me\AppData\Local\Temp\aios-installer"
  .\run-sandbox-test.ps1 -InstallerDir ... -LaunchApp -KeepOpen

-InstallerDir  the folder holding "AI OS Setup <version>.exe" (a build made with
               --config.directories.output=<folder>, never a folder you care about)
-LaunchApp     also starts the real app inside the sandbox
-KeepOpen      leave the sandbox window open afterwards so you can click around
#>
param(
    [Parameter(Mandatory = $true)][string]$InstallerDir,
    [string]$ResultsDir = (Join-Path $env:TEMP "aios-sandbox-results"),
    [int]$TimeoutMinutes = 25,
    [switch]$LaunchApp,
    [switch]$KeepOpen
)

$ErrorActionPreference = "Stop"
$sandboxExe = Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue
if (-not $sandboxExe) {
    throw "Windows Sandbox is not installed. Enable it (Optional features > Windows Sandbox, needs a restart), or follow the virtual-machine steps in docs/clean-machine-test.md."
}

$installer = Get-ChildItem -LiteralPath $InstallerDir -Filter "AI OS Setup *.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "No 'AI OS Setup *.exe' in $InstallerDir" }
$InstallerDir = (Resolve-Path $InstallerDir).Path
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $ResultsDir "results.json")
$ResultsDir = (Resolve-Path $ResultsDir).Path

# The guest script travels in the results folder (writable) so the installer folder stays read-only.
Copy-Item (Join-Path $PSScriptRoot "sandbox-check.ps1") (Join-Path $ResultsDir "sandbox-check.ps1") -Force

$launch = if ($LaunchApp) { " -LaunchApp" } else { "" }
$guest = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Results\sandbox-check.ps1 -Installer `"C:\Installer\$($installer.Name)`" -ResultsDir C:\Results\out$launch"
if ($KeepOpen) { $guest += "; Read-Host 'Press Enter to close'" }

$config = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$InstallerDir</HostFolder><SandboxFolder>C:\Installer</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$ResultsDir</HostFolder><SandboxFolder>C:\Results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>$([System.Security.SecurityElement]::Escape($guest))</Command></LogonCommand>
</Configuration>
"@
$wsb = Join-Path $ResultsDir "ai-os-clean.wsb"
Set-Content -Path $wsb -Value $config -Encoding UTF8

Write-Host "Starting Windows Sandbox with $($installer.Name) ..."
Start-Process $wsb
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$out = Join-Path $ResultsDir "out\results.json"
while ((Get-Date) -lt $deadline -and -not (Test-Path $out)) { Start-Sleep -Seconds 5 }
if (-not (Test-Path $out)) { throw "No results after $TimeoutMinutes minutes. Look at the sandbox window." }

$rows = Get-Content $out -Raw | ConvertFrom-Json
$rows | Format-Table check, ok, required, detail -AutoSize -Wrap
$failed = @($rows | Where-Object { $_.required -and -not $_.ok })
Write-Host ("{0} required check(s) failed. Full results: {1}" -f $failed.Count, $out)
exit $(if ($failed.Count -eq 0) { 0 } else { 1 })
