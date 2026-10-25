<#
Weekly Backlog Report - Excel processing step 2 of 2.

Builds a REAL, native Excel PivotTable (not a lookalike formula table) on the
workbook produced by build_report.py + Recalc-Workbook.ps1:
  Rows:    Priority > Assigned to
  Columns: Age Bucket
  Values:  Count of Number
...then applies PivotTable filters:
  - Age Bucket: only the 3 aged buckets (hides the blank "not yet 15 days" bucket)
  - Assigned to: only the names listed in output/pivot-input.json's
    visible_assigned_to (i.e. the roster in ../../shared/roster/Names.xlsx), matching how
    the reference report's PivotTable field filter was set up by hand.

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
$xlColumnField = 2
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
    $pt = $cache.CreatePivotTable($pivotSheet.Range("A3"), "BacklogPivot")

    $pt.PivotFields("Priority").Orientation = $xlRowField
    $pt.PivotFields("Priority").Position = 1
    $pt.PivotFields("Assigned to").Orientation = $xlRowField
    $pt.PivotFields("Assigned to").Position = 2
    $pt.PivotFields("Age Bucket").Orientation = $xlColumnField

    $dataField = $pt.PivotFields("Number")
    $dataField.Orientation = $xlDataField
    $dataField.Function = $xlCount

    # Filter Age Bucket: show only the 3 aged buckets (hide the blank bucket),
    # in chronological order (Excel would otherwise order them by first
    # appearance in the source data, not by age).
    $targetBuckets = @("15-30 days", "31-45 days", ">45 days")
    $bucketField = $pt.PivotFields("Age Bucket")
    foreach ($item in $bucketField.PivotItems()) {
        $item.Visible = $targetBuckets -contains $item.Name
    }
    for ($i = 0; $i -lt $targetBuckets.Count; $i++) {
        $bucketField.PivotItems($targetBuckets[$i]).Position = $i + 1
    }

    # Filter Assigned to: show only names matched to the roster (../../shared/roster/Names.xlsx)
    $assignedField = $pt.PivotFields("Assigned to")
    $visibleSet = New-Object System.Collections.Generic.HashSet[string]
    foreach ($n in $visibleNames) { [void]$visibleSet.Add($n) }
    foreach ($item in $assignedField.PivotItems()) {
        $item.Visible = $visibleSet.Contains($item.Name)
    }

    $pivotSheet.Columns.Item(1).ColumnWidth = 26.33
    $pivotSheet.Columns.Item(2).ColumnWidth = 15.5
    $pivotSheet.Columns.Item(3).ColumnWidth = 15.5
    $pivotSheet.Columns.Item(4).ColumnWidth = 15.5
    $pivotSheet.Columns.Item(5).ColumnWidth = 15.5

    $wb.Save()
    $wb.Close($true)
    Write-Output "Pivot table created in: $workbookPath"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
