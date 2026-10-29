<#
QA harness - guest agent. Runs inside Windows Sandbox (started by the .wsb LogonCommand).
It turns the writable results folder into a remote shell for the host:

  host writes   C:\Results\cmd\NNN-name.ps1   (or .mjs = run with the installed app's electron as node)
  agent runs it, writes NNN-name.ps1.out / .err / .done (exit code) next to it.

Only files in C:\Results\cmd are executed (that folder is the host's QA results folder, mapped by the .wsb).
Heartbeat: C:\Results\agent.alive is rewritten every loop. Test tooling only - not part of the app.
#>
$ErrorActionPreference = "Continue"
$R = "C:\Results"
$cmd = Join-Path $R "cmd"
New-Item -ItemType Directory -Force -Path $cmd | Out-Null
$AppExe = Join-Path $env:LOCALAPPDATA "Programs\AI OS\AI OS.exe"
"agent started $(Get-Date -Format o) user=$env:USERNAME" | Set-Content (Join-Path $R "agent.log")

function Stop-Tree($pid_) { & taskkill.exe /PID $pid_ /T /F 2>&1 | Out-Null }

while ($true) {
    "$(Get-Date -Format o)" | Set-Content (Join-Path $R "agent.alive") -ErrorAction SilentlyContinue
    $todo = Get-ChildItem -LiteralPath $cmd -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in ".ps1", ".mjs", ".js" } |
        Where-Object { -not (Test-Path -LiteralPath ($_.FullName + ".done")) -and -not (Test-Path -LiteralPath ($_.FullName + ".running")) } |
        Sort-Object Name
    foreach ($f in $todo) {
        $out = $f.FullName + ".out"; $err = $f.FullName + ".err"
        "running" | Set-Content ($f.FullName + ".running")
        $timeoutMs = 900000
        $first = Get-Content -LiteralPath $f.FullName -TotalCount 3 -ErrorAction SilentlyContinue
        foreach ($l in $first) { if ($l -match "qa-timeout-sec:\s*(\d+)") { $timeoutMs = [int]$Matches[1] * 1000 } }
        try {
            if ($f.Extension -eq ".ps1") {
                $p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$($f.FullName)`"") `
                    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
            } else {
                $env:ELECTRON_RUN_AS_NODE = "1"
                $p = Start-Process -FilePath $AppExe -ArgumentList @("`"$($f.FullName)`"") `
                    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
                Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            }
            $null = $p.Handle  # cache the handle so ExitCode is readable after exit (PS 5.1 quirk)
            if (-not $p.WaitForExit($timeoutMs)) { Stop-Tree $p.Id; "TIMEOUT after $timeoutMs ms" | Add-Content $err; $code = 124 } else { $code = $p.ExitCode }
        } catch { $_ | Out-String | Add-Content $err; $code = 125 }
        "$code" | Set-Content ($f.FullName + ".done")
        Remove-Item -LiteralPath ($f.FullName + ".running") -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 300
}
