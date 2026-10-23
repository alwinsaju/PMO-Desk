<#
Recalculates all formulas in an .xlsx file using the installed Excel application
(used instead of the xlsx skill's LibreOffice-based recalc.py, which needs a
POSIX socket API not available in this native Windows Python environment).

Takes a sidecar JSON path (matching create_pivot.ps1) rather than the workbook
path directly, since build_report.py's output filename is date-stamped and
agent.json's step args are static - the sidecar's output_path is the only
thing that can point at each run's actual file.

Usage: powershell -File Recalc-Workbook.ps1 -SidecarPath "...\output\pivot-input.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$SidecarPath
)

$sidecar = Get-Content -Raw -Path $SidecarPath | ConvertFrom-Json
$Path = (Resolve-Path $sidecar.output_path).Path
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    $wb = $excel.Workbooks.Open($Path)
    $excel.CalculateFullRebuild()
    $wb.Save()
    $wb.Close($true)
    Write-Output "Recalculated: $Path"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
