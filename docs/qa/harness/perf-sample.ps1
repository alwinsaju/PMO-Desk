<# QA harness: samples CPU% (of one logical core x 100 / ncores = % of whole machine, also raw core-%) and working set for every process under <AppRoot>. 
  .\perf-sample.ps1 -AppRoot <...\host\app> -Out <csv> -IntervalSec 5 -Seconds 0   (0 = until killed) #>
param([string]$AppRoot, [string]$Out, [int]$IntervalSec = 5, [int]$Seconds = 0, [string]$Tag = "")
$cores = [Environment]::ProcessorCount
$prev = @{}; $t0 = Get-Date; $prevT = $t0
"time,tag,role,pid,cpu_core_pct,ws_mb,threads,handles" | Set-Content $Out
while ($true) {
  Start-Sleep -Seconds $IntervalSec
  $now = Get-Date; $dt = ($now - $prevT).TotalSeconds; $prevT = $now
  $procs = Get-CimInstance Win32_Process | ? { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($AppRoot, [StringComparison]::OrdinalIgnoreCase) }
  foreach ($c in $procs) {
    $p = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue; if (-not $p) { continue }
    $cpu = $p.TotalProcessorTime.TotalSeconds
    $role = $c.Name
    if ($c.CommandLine -match '--type=(\w[\w-]*)') { $role = "electron-" + $Matches[1] } elseif ($c.CommandLine -match 'next') { $role = "next-server" } elseif ($c.Name -eq 'AI OS.exe') { $role = "electron-main" }
    if ($prev.ContainsKey($c.ProcessId)) {
      $pct = [math]::Round((($cpu - $prev[$c.ProcessId]) / $dt) * 100, 1)
      "{0},{1},{2},{3},{4},{5},{6},{7}" -f $now.ToString("o"), $Tag, $role, $c.ProcessId, $pct, [math]::Round($p.WorkingSet64 / 1MB, 1), $p.Threads.Count, $p.HandleCount | Add-Content $Out
    }
    $prev[$c.ProcessId] = $cpu
  }
  if ($Seconds -gt 0 -and ($now - $t0).TotalSeconds -ge $Seconds) { break }
}
