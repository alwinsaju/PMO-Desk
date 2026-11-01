<#
Runs the clean-machine check in Windows Sandbox: a throw-away Windows with none of
this machine's software, settings, OneDrive or Outlook. Needs the Windows Sandbox
feature (Windows 10/11 Pro, Enterprise or Education; Settings > Optional features >
"Windows Sandbox", then a restart). Nothing in the sandbox can reach this machine's
files except the two folders mapped below (the installer, read-only; the results,
writable).

  .\run-sandbox-test.ps1 -InstallerDir "C:\Users\me\AppData\Local\Temp\aios-installer"
  .\run-sandbox-test.ps1 -InstallerDir ... -LaunchApp -Lifecycle
  .\run-sandbox-test.ps1 -InstallerDir ... -LaunchApp -KeepOpen

-InstallerDir  the folder holding "PMO Desk Setup <version>.exe" (a build made with
               --config.directories.output=<folder>, never a folder you care about)
-LaunchApp     also starts the real app inside the sandbox (fresh profile, empty PMO inbox)
-Lifecycle     also reinstalls over the top and uninstalls (the sandbox ends with PMO Desk removed)
-KeepOpen      leave the sandbox open afterwards so you can click around (not with -Lifecycle)
-SkipPolicyCheck  skip the up-front check for a device policy that disables Windows Sandbox

Without -KeepOpen the sandbox shuts itself down once the results are written.
Windows Sandbox is blocked on many managed PCs (see docs/clean-machine-test.md); the policy
check below says so at once instead of waiting out -TimeoutMinutes.
#>
param(
    [Parameter(Mandatory = $true)][string]$InstallerDir,
    [string]$ResultsDir = (Join-Path $env:TEMP "aios-sandbox-results"),
    [int]$TimeoutMinutes = 25,
    [switch]$LaunchApp,
    [switch]$Lifecycle,
    [switch]$KeepOpen,
    [switch]$SkipPolicyCheck
)

$ErrorActionPreference = "Stop"
$sandboxExe = Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue
if (-not $sandboxExe) {
    throw "Windows Sandbox is not installed. Enable it (Optional features > Windows Sandbox, needs a restart), or follow the virtual-machine steps in docs/clean-machine-test.md."
}
if ($Lifecycle -and $KeepOpen) { throw "-Lifecycle ends with PMO Desk uninstalled, so there is nothing to click around in: use one of -Lifecycle or -KeepOpen." }

# Policy preflight: an MDM/GPO that turns the sandbox's folder mapping off makes the .wsb fail (or the guest never
# write results), and the old script then waited the full timeout. Say so at once (SBX-002).
$netPolicyOff = $false
if (-not $SkipPolicyCheck) {
    $blocked = @()
    foreach ($key in @("HKLM:\SOFTWARE\Microsoft\PolicyManager\current\device\WindowsSandbox", "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Sandbox")) {
        $pol = $null
        if (Test-Path -LiteralPath $key) { $pol = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue }
        if (-not $pol) { continue }
        foreach ($name in "AllowMappedFolders", "AllowWriteToMappedFolders") {
            if ($null -ne $pol.$name -and [int]$pol.$name -eq 0) { $blocked += "$name=0 ($key)" }
        }
        if ($null -ne $pol.AllowNetworking -and [int]$pol.AllowNetworking -eq 0) { $netPolicyOff = $true }
    }
    if ($blocked.Count -gt 0) {
        throw ("Windows Sandbox is disabled by device policy on this PC: {0}. This script maps the installer and results folders, so it cannot run here. Run scripts/clean-machine/sandbox-check.ps1 inside a clean VM or another machine instead (docs/clean-machine-test.md, section 2). Use -SkipPolicyCheck to try anyway." -f ($blocked -join "; "))
    }
}
$sandboxProcs = @("WindowsSandboxClient", "WindowsSandboxRemoteSession")
if (@(Get-Process -Name $sandboxProcs -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "A Windows Sandbox is already running (only one can run at a time). Close it first."
}

$installer = Get-ChildItem -LiteralPath $InstallerDir -Filter "PMO Desk Setup *.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "No 'PMO Desk Setup *.exe' in $InstallerDir" }
$InstallerDir = (Resolve-Path $InstallerDir).Path
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$ResultsDir = (Resolve-Path $ResultsDir).Path
# The guest writes C:\Results\out\results.json, i.e. <ResultsDir>\out\results.json. The old script cleared and
# read the wrong path, so a result left by an earlier run counted as this run's (SBX-003).
$outDir = Join-Path $ResultsDir "out"
$out = Join-Path $outDir "results.json"
if (Test-Path -LiteralPath $outDir) { Remove-Item -Recurse -Force -LiteralPath $outDir }

# The guest script travels in the results folder (writable) so the installer folder stays read-only.
Copy-Item (Join-Path $PSScriptRoot "sandbox-check.ps1") (Join-Path $ResultsDir "sandbox-check.ps1") -Force

# The guest runs the check with -Command, not -File: text appended after -File <script> is handed to the script
# as arguments, so the old "; Read-Host" for -KeepOpen broke the call (SBX-004). Without -KeepOpen the guest
# powers itself off after the check so the sandbox does not linger (SBX-005).
$installerName = $installer.Name -replace "'", "''"
$checkCall = "& 'C:\Results\sandbox-check.ps1' -Installer 'C:\Installer\$installerName' -ResultsDir 'C:\Results\out'"
if ($LaunchApp) { $checkCall += " -LaunchApp" }
if ($Lifecycle) { $checkCall += " -Lifecycle" }
$tail = if ($KeepOpen) { "; Read-Host 'Press Enter to close the sandbox'" } else { "; Start-Sleep -Seconds 2; shutdown.exe /s /t 0" }
$guest = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"$checkCall$tail`""
$networking = if ($netPolicyOff) { "Disable" } else { "Enable" }   # the check needs no network; a policy that forbids it would reject the .wsb

$config = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>$networking</Networking>
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
$started = Get-Date
$deadline = $started.AddMinutes($TimeoutMinutes)
$seen = $false
while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $out)) {
    Start-Sleep -Seconds 5
    $alive = @(Get-Process -Name $sandboxProcs -ErrorAction SilentlyContinue).Count -gt 0
    if ($alive) { $seen = $true }
    elseif ($seen) {
        Start-Sleep -Seconds 10   # the sandbox closed; give the mapped folder a moment, then stop waiting
        if (-not (Test-Path -LiteralPath $out)) { throw "The sandbox closed before it wrote $out. Re-run, and look at the sandbox window while it runs." }
    } elseif (((Get-Date) - $started).TotalSeconds -gt 120 -and ((Get-Date) - $started).TotalSeconds -lt 125) {
        Write-Warning "No Windows Sandbox window detected after 2 minutes; still waiting for $out."
    }
}
if (-not (Test-Path -LiteralPath $out)) { throw "No results after $TimeoutMinutes minutes. Look at the sandbox window (left open)." }

if (-not $KeepOpen) {
    # The guest shuts itself down after writing the results; end it here if it has not (SBX-005).
    $stop = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $stop -and @(Get-Process -Name $sandboxProcs -ErrorAction SilentlyContinue).Count -gt 0) { Start-Sleep -Seconds 3 }
    $left = @(Get-Process -Name $sandboxProcs -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) { Write-Host "Sandbox still open after 90 s: closing it."; $left | Stop-Process -Force -ErrorAction SilentlyContinue }
}

$rows = Get-Content $out -Raw | ConvertFrom-Json
$rows | Format-Table check, ok, required, detail -AutoSize -Wrap
$failed = @($rows | Where-Object { $_.required -and -not $_.ok })
Write-Host ("{0} required check(s) failed. Full results: {1}" -f $failed.Count, $out)
exit $(if ($failed.Count -eq 0) { 0 } else { 1 })
