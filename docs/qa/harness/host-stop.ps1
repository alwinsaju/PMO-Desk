<#
QA harness - kills every process whose executable lives under <Root>\app (electron tree, the bundled
python/pythonw engine, the next server run as electron-node). Nothing else is touched.
  .\host-stop.ps1 -Root <scratch\host>
#>
param([Parameter(Mandatory = $true)][string]$Root)
$app = (Join-Path (Resolve-Path $Root).Path "app")
$procs = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) }
$procs | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ExecutablePath }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$left = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) }
"left after stop: $(@($left).Count)"
