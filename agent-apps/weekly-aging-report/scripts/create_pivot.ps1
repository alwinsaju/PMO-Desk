<#
Weekly Aging Report - step 2 of 2.

Builds a REAL, native Excel PivotTable (not a lookalike formula table) on the
workbook produced by build_report.py:
  Rows:  Priority > Assigned to > Updated (Day)
  Data:  Count of Number
No column field, but the "Assigned to" row field IS filtered - same as the
backlog report - to just the roster in ../../shared/roster/Names.xlsx, via
build_report.py's visible_assigned_to (its roster-matched raw "Assigned to"
values).

Uses build_report.py's "Updated (Day)" helper column (the "Updated" timestamp
truncated to midnight) as the third row level, instead of using Excel's own
PivotField date Group() API on the raw "Updated" column. Group() proved
unreliable when driven headlessly via COM in this environment - across
several attempts (Periods-only, numeric By interval, single-cell vs. range
selection) it kept silently collapsing the whole date range into one bucket
(or defaulting to a coarse "Months" auto-grouping) regardless of the
requested interval, confirmed even in an isolated minimal test workbook.
Using a pre-truncated column sidesteps that entirely: duplicate day values
collapse into one pivot item on their own, which is standard pivot table
behavior with no grouping call required.

Usage: powershell -File create_pivot.ps1 -SidecarPath "...\output\pivot-input.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$SidecarPath
)

$ErrorActionPreference = "Stop"

$sidecar = Get-Content -Raw -Path $SidecarPath | ConvertFrom-Json
$workbookPath = (Resolve-Path $sidecar.output_path).Path
$visibleNames = @($sidecar.visible_assigned_to)

$xlDatabase = 1
$xlRowField = 1
$xlDataField = 4
$xlCount = -4112

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $wb = $excel.Workbooks.Open($workbookPath)
    $srcSheet = $wb.Sheets.Item("Page 1")
    $usedRange = $srcSheet.UsedRange
    $lastRow = $usedRange.Rows.Count
    $lastCol = $usedRange.Columns.Count
    $sourceData = "'Page 1'!R1C1:R" + $lastRow + "C" + $lastCol

    foreach ($sheet in $wb.Sheets) {
        if ($sheet.Name -eq "Sheet1") { $sheet.Delete() }
    }
    $pivotSheet = $wb.Sheets.Add()
    $pivotSheet.Move($wb.Sheets.Item(1))
    $pivotSheet.Name = "Sheet1"

    $cache = $wb.PivotCaches().Create($xlDatabase, $sourceData)
    $pt = $cache.CreatePivotTable($pivotSheet.Range("A3"), "AgingPivot")

    $pt.PivotFields("Priority").Orientation = $xlRowField
    $pt.PivotFields("Priority").Position = 1
    $pt.PivotFields("Assigned to").Orientation = $xlRowField
    $pt.PivotFields("Assigned to").Position = 2
    $pt.PivotFields("Updated (Day)").Orientation = $xlRowField
    $pt.PivotFields("Updated (Day)").Position = 3
    $pt.PivotFields("Updated (Day)").NumberFormat = "d-mmm"

    $dataField = $pt.PivotFields("Number")
    $dataField.Orientation = $xlDataField
    $dataField.Function = $xlCount

    # Filter Assigned to: show only names matched to the roster
    # (../../shared/roster/Names.xlsx), same as the backlog report.
    $assignedField = $pt.PivotFields("Assigned to")
    $visibleSet = New-Object System.Collections.Generic.HashSet[string]
    foreach ($n in $visibleNames) { [void]$visibleSet.Add($n) }
    foreach ($item in $assignedField.PivotItems()) {
        $item.Visible = $visibleSet.Contains($item.Name)
    }

    $pivotSheet.Columns.Item(1).ColumnWidth = 30
    $pivotSheet.Columns.Item(2).ColumnWidth = 15.5

    $wb.Save()
    $wb.Close($true)
    Write-Output "Pivot table created in: $workbookPath"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
