param(
    [Parameter(Mandatory = $true)][string]$SidecarPath
)

$ErrorActionPreference = "Stop"

$sidecar = Get-Content -Raw -Path $SidecarPath | ConvertFrom-Json
$templatePath = (Resolve-Path $sidecar.template_path).Path
$stagingPath = (Resolve-Path $sidecar.staging_path).Path
$workbookPath = [System.IO.Path]::GetFullPath($sidecar.workbook_path)
$workbookDirectory = Split-Path -Parent $workbookPath

New-Item -ItemType Directory -Path $workbookDirectory -Force | Out-Null
Copy-Item -Path $templatePath -Destination $workbookPath -Force

$pythonPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..\.venv\Scripts\python.exe")).Path
$patcherPath = Join-Path $PSScriptRoot "patch_pivot_sources.py"
$expectedLastRow = [int]$sidecar.incident_count + 1
& $pythonPath $patcherPath --workbook $workbookPath --last-row $expectedLastRow
if ($LASTEXITCODE -ne 0) {
    throw "Failed to update local pivot cache source ranges."
}

# Fold the human's in-app Subcategory2 resolutions into the staging workbook
# before its rows are copied into the analysis workbook. A no-op when the
# review gate was approved without resolving anything (file absent/empty).
$resolutionsPath = Join-Path $PSScriptRoot "..\output\review-resolutions.json"
if (Test-Path $resolutionsPath) {
    $applyPath = Join-Path $PSScriptRoot "apply_resolutions.py"
    & $pythonPath $applyPath --staging $stagingPath --resolutions $resolutionsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply review resolutions to the staging workbook."
    }
}

# Excel refuses to delete a very-hidden sheet over COM ("Unable to get the
# Delete property of the Worksheet class"). The rolled-forward template carries
# the previous month's very-hidden "Intake Data", so make the sheet visible
# first. Name matches are exact; a missing sheet is a no-op.
function Remove-WorksheetIfPresent($targetWorkbook, [string]$sheetName) {
    foreach ($candidate in @($targetWorkbook.Worksheets)) {
        if ($candidate.Name -eq $sheetName) {
            $candidate.Visible = -1 # xlSheetVisible
            $candidate.Delete()
            break
        }
    }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
$stagingWorkbook = $null
$workbook = $null
$stage = "open staging workbook"

try {
    $stagingWorkbook = $excel.Workbooks.Open($stagingPath, 0, $true)
    $stage = "open analysis workbook"
    $workbook = $excel.Workbooks.Open($workbookPath, 0, $false)

    $stage = "parse report month"
    $reportMonth = [datetime]::Parse($sidecar.report_month)
    $stage = "find trend analysis sheet"
    $trendSheet = $workbook.Worksheets.Item("Trend analysis")
    $stage = "read template month cell"
    $trendCells = $trendSheet.Cells
    $templateMonthCell = $trendCells.Item(1, 1)
    $templateMonthValue = $templateMonthCell.Value2
    if ($templateMonthValue -isnot [double]) {
        throw "The analysis template does not have a valid current-month date in 'Trend analysis'!A1."
    }
    $stage = "convert template month"
    $templateMonth = [datetime]::FromOADate($templateMonthValue)
    $monthsApart = ($reportMonth.Year - $templateMonth.Year) * 12 + ($reportMonth.Month - $templateMonth.Month)
    if ($monthsApart -lt 0) {
        throw "The $($templateMonth.ToString('MMMM yyyy')) template is newer than the $($reportMonth.ToString('MMMM yyyy')) export; use the matching or prior-month workbook as the template."
    }
    if ($monthsApart -eq 0) {
        throw "The template is already the $($reportMonth.ToString('MMMM yyyy')) workbook. prepare_data.py's history discovery always selects the previous month as the template, so a same-month re-run re-rolls from there - do not point the sidecar at the report month's own file."
    }
    if ($monthsApart -gt 1) {
        throw "The $($templateMonth.ToString('MMMM yyyy')) template is $monthsApart months behind the $($reportMonth.ToString('MMMM yyyy')) export; process each month in order so no month is skipped in history."
    }
    Write-Output "Rolling template forward: $($templateMonth.ToString('MMMM yyyy')) -> $($reportMonth.ToString('MMMM yyyy'))"

    $stagingSheet = $stagingWorkbook.Worksheets.Item("Incidents")
    $stagingRange = $stagingSheet.UsedRange
    $lastRow = $stagingRange.Rows.Count
    $lastColumn = $stagingRange.Columns.Count
    if ($lastColumn -ne 20) {
        throw "Prepared incident data must contain exactly 20 columns; found $lastColumn."
    }

    $stage = "replace incident data"
    $incidentSheet = $workbook.Worksheets.Item("Incidents")
    if ($incidentSheet.AutoFilterMode) {
        $incidentSheet.AutoFilterMode = $false
    }
    # Clear the WHOLE Incidents grid (every cell in columns A:T), not
    # UsedRange.ClearContents(). A values-only paste never deletes existing
    # cells and the stale template's UsedRange was both unreliable and ragged,
    # so residue (ghost Priority/State/Assignment-group values and whole stale
    # numbered rows) survived past the new data - inflating the row count and
    # the pivot totals. Clearing the full columns is deterministic: nothing
    # below/around the incoming month survives. (Row DELETION was tried and
    # rejected - it shifts cells up and mangles the sheet further.)
    $incidentSheet.Range("A:T").Clear() | Out-Null
    $stagingRange.Copy() | Out-Null
    $incidentSheet.Range("A1").PasteSpecial(-4163) | Out-Null
    # Delete the (now-empty) whole rows below the pasted block. Clearing values
    # alone does NOT shrink the sheet's stored used-range - the template's extent
    # runs thousands of rows past its data, so Excel would still scroll/select
    # that far. EntireRow.Delete on the empty tail collapses the extent to the
    # new month. This is done AFTER the paste (not before), so it only ever
    # removes already-cleared rows and never shifts real data.
    $lastUsed = $incidentSheet.UsedRange.Rows.Count
    if ($lastUsed -gt $lastRow) {
        $incidentSheet.Range("A$($lastRow + 1):XFD$lastUsed").EntireRow.Delete() | Out-Null
    }
    $incidentSheet.Range("C2:D$lastRow").NumberFormat = "m/d/yyyy h:mm"
    $incidentSheet.Range("A1:T1").Font.Bold = $true
    if ($incidentSheet.AutoFilterMode) {
        $incidentSheet.AutoFilterMode = $false
    }
    $incidentSheet.Range("A1:T$lastRow").AutoFilter() | Out-Null

    $stage = "build Deloitte intake source"
    Remove-WorksheetIfPresent $workbook "Intake Data"
    $incidentValues = $incidentSheet.Range("A1:T$lastRow").Value2
    $intakeRows = [System.Collections.Generic.List[object]]::new()
    for ($row = 2; $row -le $lastRow; $row++) {
        $openedValue = $incidentValues[$row, 3]
        if ($incidentValues[$row, 6] -ne "Deloitte" -or $openedValue -isnot [double]) {
            continue
        }
        $openedDate = [datetime]::FromOADate($openedValue)
        if ($openedDate.Year -ne $reportMonth.Year -or $openedDate.Month -ne $reportMonth.Month) {
            continue
        }
        $intakeRow = New-Object object[] 20
        for ($columnIndex = 0; $columnIndex -lt 20; $columnIndex++) {
            $sourceColumn = $columnIndex + 1
            $intakeRow[$columnIndex] = $incidentValues[$row, $sourceColumn]
        }
        $intakeRows.Add([object]$intakeRow)
    }
    if ($intakeRows.Count -ne [int]$sidecar.metrics.intake) {
        throw "The Deloitte intake source contains $($intakeRows.Count) rows, but the report metric is $($sidecar.metrics.intake)."
    }
    $intakeRowCount = [int]$intakeRows.Count
    $intakeValues = [System.Array]::CreateInstance([object], [int[]]@(($intakeRowCount + 1), 20))
    for ($columnIndex = 0; $columnIndex -lt 20; $columnIndex++) {
        $sourceColumn = $columnIndex + 1
        $intakeValues[0, $columnIndex] = $incidentValues[1, $sourceColumn]
    }
    for ($rowIndex = 0; $rowIndex -lt $intakeRowCount; $rowIndex++) {
        $targetRow = $rowIndex + 1
        for ($columnIndex = 0; $columnIndex -lt 20; $columnIndex++) {
            $intakeValues[$targetRow, $columnIndex] = $intakeRows[$rowIndex][$columnIndex]
        }
    }
    $intakeSheet = $workbook.Worksheets.Add()
    $intakeSheet.Name = "Intake Data"
    $intakeSheet.Range(
        $intakeSheet.Cells.Item(1, 1),
        $intakeSheet.Cells.Item($intakeRowCount + 1, 20)
    ).Value2 = $intakeValues
    $intakeSheet.Visible = 2 # xlSheetVeryHidden
    $intakeSourceReference = "'Intake Data'!R1C1:R$($intakeRowCount + 1)C20"
    $intakeChartSourceReference = "'Intake Data'!R1C1:R$($intakeRowCount + 1)C19"

    $stage = "replace organization lookup"
    $orgSource = $stagingWorkbook.Worksheets.Item("Org").UsedRange
    $orgSheet = $workbook.Worksheets.Item("Org")
    $orgSheet.UsedRange.ClearContents()
    $orgSource.Copy() | Out-Null
    $orgSheet.Range("A1").PasteSpecial(-4163) | Out-Null
    $orgLastRow = $orgSource.Rows.Count
    $orgSheet.Range("A1:B1").Font.Bold = $true
    if ($orgSheet.AutoFilterMode) {
        $orgSheet.AutoFilterMode = $false
    }
    $orgSheet.Range("A1:B$orgLastRow").AutoFilter() | Out-Null

    Remove-WorksheetIfPresent $workbook "Review Needed"
    $stage = "create review sheet"
    $reviewSource = $stagingWorkbook.Worksheets.Item("Review Needed")
    $reviewRange = $reviewSource.UsedRange
    $reviewSheet = $workbook.Worksheets.Add()
    $reviewSheet.Name = "Review Needed"
    $reviewRange.Copy() | Out-Null
    $reviewSheet.Range("A1").PasteSpecial(-4163) | Out-Null
    $reviewSheet.Range("A1:U1").Font.Bold = $true
    $reviewSheet.Columns.Item(1).ColumnWidth = 14
    $reviewSheet.Columns.Item(11).ColumnWidth = 45
    $reviewSheet.Columns.Item(18).ColumnWidth = 70
    $reviewSheet.Columns.Item(21).ColumnWidth = 55
    $reviewSheet.Range("A1:U$($reviewRange.Rows.Count)").AutoFilter() | Out-Null
    $lastSheet = $workbook.Worksheets.Item($workbook.Worksheets.Count)
    $reviewSheet.Move([System.Reflection.Missing]::Value, $lastSheet)

    $stage = "roll trend analysis forward"
    # Roll forward = PRESERVE the previous month and build a new block, never refresh
    # history in place. (The old in-place refresh overwrote July's block with August
    # data and left the static "Total incidents" cell stale.) The current-month block
    # is the only Trend analysis pivot sourced from the local Incidents sheet; older
    # blocks are frozen values or externally-backed pivots and are left untouched.
    $percentFormat = "0.00%"
    $currentPivots = @()
    foreach ($pivot in @($trendSheet.PivotTables())) {
        if ([string]$pivot.SourceData -match "^'?Incidents'?!") { $currentPivots += $pivot }
    }
    # Charts whose series read the LOCAL (current-month) summary table are re-aimed at
    # the new table afterwards. External series ('[1]Trend analysis'!...) stay as-is.
    $localTrendCharts = @()
    foreach ($chartObject in @($trendSheet.ChartObjects())) {
        foreach ($series in @($chartObject.Chart.SeriesCollection())) {
            if ([string]$series.Formula -match "^=SERIES\('?Trend analysis'?!\$") {
                $localTrendCharts += $chartObject.Name
                break
            }
        }
    }

    foreach ($pivot in $currentPivots) {
        $blockRange = $pivot.TableRange2
        $blockTop = $blockRange.Row
        $blockLeft = $blockRange.Column
        $blockBottom = $blockTop + $blockRange.Rows.Count - 1
        # The current block spans four columns: the pivot, its summary, and the
        # helper percentages. Snapshot all of it before clearing the pivot so no
        # formulas survive to become #REF! after the monthly columns shift right.
        $snapshotBottom = $blockBottom + 12
        $snapshotRight = $blockLeft + 3
        $snapshotRange = $trendSheet.Range(
            $trendSheet.Cells.Item(1, $blockLeft),
            $trendSheet.Cells.Item($snapshotBottom, $snapshotRight)
        )
        $snapshotValues = $snapshotRange.Value2
        $blockRange.Clear() | Out-Null
        $snapshotRange.Value2 = $snapshotValues
    }
    # Make room at the left: history shifts right, the new month's block goes first.
    $trendSheet.Range("A:C").EntireColumn.Insert() | Out-Null

    $stage = "create current month pivot"
    $pivotCache = $workbook.PivotCaches().Create(1, $intakeSourceReference) # xlDatabase
    $pivotName = "Trend_" + $reportMonth.ToString("yyyyMM")
    $pivot = $pivotCache.CreatePivotTable($trendSheet.Range("A6"), $pivotName)
    $pivot.AddFields("Subcategory2") | Out-Null
    $pivot.AddDataField($pivot.PivotFields("Number"), "Count of Number", -4112) | Out-Null # xlCount
    $categoryField = $pivot.PivotFields("Subcategory2")
    $categoryField.AutoSort(2, "Count of Number")
    # WIP and Cancelled stay VISIBLE: this block reconciles to the Deloitte
    # intake count. The top-9 summary below still excludes placeholders - it
    # feeds the issue-drivers chart.

    $trendSheet.Cells.Item(1, 1).Value2 = $reportMonth.ToOADate()
    $trendSheet.Cells.Item(1, 1).NumberFormat = "mmmm yyyy"
    $trendSheet.Cells.Item(2, 1).Value2 = "Total incidents"
    $trendSheet.Cells.Item(2, 1).Font.Bold = $true
    $trendSheet.Cells.Item(3, 1).Value2 = [int]$sidecar.metrics.intake
    $trendSheet.Cells.Item(3, 1).Font.Bold = $true

    $stage = "build top-9 summary table"
    $pivotRange = $pivot.TableRange2
    $grandTotalRow = $pivotRange.Row + $pivotRange.Rows.Count - 1
    $topItems = @()
    for ($row = $pivotRange.Row + 1; $row -lt $grandTotalRow; $row++) {
        $label = $trendSheet.Cells.Item($row, 1).Value2
        $count = $trendSheet.Cells.Item($row, 2).Value2
        if ($null -ne $label -and $null -ne $count -and @("WIP", "Cancelled") -notcontains "$label") {
            $topItems += [pscustomobject]@{ Label = "$label"; Count = [double]$count }
        }
    }
    $topItems = @($topItems | Sort-Object Count -Descending | Select-Object -First 9 | Sort-Object Count)
    $summaryHeaderRow = $grandTotalRow + 2
    $trendSheet.Cells.Item($summaryHeaderRow, 1).Value2 = "Sub-Category"
    $trendSheet.Cells.Item($summaryHeaderRow, 2).Value2 = "Count of SUB CATEGORY"
    $trendSheet.Cells.Item($summaryHeaderRow, 3).Value2 = "% of Occurence"
    $trendSheet.Range($trendSheet.Cells.Item($summaryHeaderRow, 1), $trendSheet.Cells.Item($summaryHeaderRow, 3)).Font.Bold = $true
    for ($index = 0; $index -lt $topItems.Count; $index++) {
        $row = $summaryHeaderRow + 1 + $index
        $trendSheet.Cells.Item($row, 1).Value2 = $topItems[$index].Label
        $trendSheet.Cells.Item($row, 2).Value2 = [int]$topItems[$index].Count
        $percentCell = $trendSheet.Cells.Item($row, 3)
        $percentCell.Value2 = $topItems[$index].Count / [double]$sidecar.metrics.intake
        $percentCell.NumberFormat = $percentFormat
    }
    $summaryLastRow = $summaryHeaderRow + $topItems.Count

    $stage = "repoint current-month trend chart"
    $firstDataRow = $summaryHeaderRow + 1
    foreach ($chartName in $localTrendCharts) {
        $chartObject = $trendSheet.ChartObjects($chartName)
        foreach ($series in @($chartObject.Chart.SeriesCollection())) {
            if ([string]$series.Formula -match "Trend analysis") {
                $series.Formula = (
                    '=SERIES(''Trend analysis''!$C${0},''Trend analysis''!$A${1}:$A${2},''Trend analysis''!$C${1}:$C${2},1)' -f
                    $summaryHeaderRow, $firstDataRow, $summaryLastRow
                )
            }
        }
        # Inserting the new month shifts the reused current-month chart right;
        # keep it directly below the new summary instead of under old history.
        $chartObject.Left = $trendSheet.Cells.Item($summaryHeaderRow, 1).Left
        $chartObject.Top = $trendSheet.Cells.Item($summaryLastRow + 3, 1).Top
    }

    $stage = "refresh intake chart pivots"
    $intakePivotCache = $workbook.PivotCaches().Create(1, $intakeChartSourceReference) # xlDatabase
    $chartsSheet = $workbook.Worksheets.Item("Charts")
    $stage = "refresh intake chart pivot PivotTable1"
    $applicationPivot = $chartsSheet.PivotTables("PivotTable1")
    $applicationPivot.ChangePivotCache($intakePivotCache)
    $applicationPivot.PivotCache().Refresh() | Out-Null
    $applicationPivot.RefreshTable() | Out-Null

    # The state breakdown is an intake analysis, so rebuild it against the same
    # Deloitte/current-month source as the application and priority pivots.
    # Excel rejects a cache swap for this page-and-row layout.
    $stage = "rebuild intake chart pivot PivotTable3"
    $statePivot = $chartsSheet.PivotTables("PivotTable3")
    $statePivot.TableRange2.Clear() | Out-Null
    $statePivot = $intakePivotCache.CreatePivotTable($chartsSheet.Range("A19"), "PivotTable3")
    $statePivot.PivotFields("Org").Orientation = 3 # xlPageField
    $statePivot.PivotFields("Org").CurrentPage = "Deloitte"
    $statePivot.PivotFields("State").Orientation = 1 # xlRowField
    $statePivot.AddDataField($statePivot.PivotFields("Number"), "Count of Number", -4112) | Out-Null # xlCount
    $statePivot.RefreshTable() | Out-Null

    # PivotTable2 has a multi-column layout Excel cannot retarget in place.
    # Recreate it at the same anchor so its linked application-priority chart
    # continues to read the standard M:R backing table.
    $stage = "rebuild intake chart pivot PivotTable2"
    $priorityPivot = $chartsSheet.PivotTables("PivotTable2")
    $priorityPivot.TableRange2.Clear() | Out-Null
    $priorityPivot = $intakePivotCache.CreatePivotTable($chartsSheet.Range("M1"), "PivotTable2")
    $priorityPivot.PivotFields("Org").Orientation = 3 # xlPageField
    $priorityPivot.PivotFields("Org").CurrentPage = "Deloitte"
    $priorityPivot.PivotFields("AG2").Orientation = 1 # xlRowField
    $priorityPivot.PivotFields("Priority").Orientation = 2 # xlColumnField
    $priorityPivot.AddDataField($priorityPivot.PivotFields("Number"), "Count of Number", -4112) | Out-Null # xlCount
    $priorityPivot.RefreshTable() | Out-Null

    $stage = "refresh charts sheet pivots"
    $refreshedPivots = 1 # the new Trend analysis pivot is built from current data
    foreach ($pivot in @($chartsSheet.PivotTables())) {
        if ([string]$pivot.SourceData -match "^'?Incidents'?!") {
            $stage = "refresh Charts/$($pivot.Name)"
            $pivotCache = $pivot.PivotCache()
            $pivotCache.Refresh() | Out-Null
            $pivot.RefreshTable() | Out-Null
            $refreshedPivots++
        }
    }

    $stage = "apply chart data labels"
    foreach ($sheetName in @("Trend analysis", "Charts")) {
        $sheet = $workbook.Worksheets.Item($sheetName)
        foreach ($chartObject in @($sheet.ChartObjects())) {
            foreach ($series in @($chartObject.Chart.SeriesCollection())) {
                $series.HasDataLabels = $true
            }
        }
    }

    $stage = "update monthly metrics"
    $metricsRow = $null
    for ($row = 32; $row -le 100; $row++) {
        $value = $chartsSheet.Cells.Item($row, 1).Value2
        if ($null -ne $value -and $value -is [double]) {
            $candidate = [datetime]::FromOADate($value)
            if ($candidate.Year -eq $reportMonth.Year -and $candidate.Month -eq $reportMonth.Month) {
                $metricsRow = $row
                break
            }
        }
        elseif ($null -eq $value -and $null -eq $metricsRow) {
            $metricsRow = $row
        }
    }
    if ($null -eq $metricsRow) {
        throw "Could not find an available month row in Charts!A32:A100."
    }
    $chartsSheet.Cells.Item($metricsRow, 1).Value2 = $reportMonth.ToOADate()
    $chartsSheet.Cells.Item($metricsRow, 1).NumberFormat = "mmm"
    $chartsSheet.Cells.Item($metricsRow, 2).Value2 = [int]$sidecar.metrics.intake
    $chartsSheet.Cells.Item($metricsRow, 3).Value2 = [int]$sidecar.metrics.closed_or_resolved
    $chartsSheet.Cells.Item($metricsRow, 4).Value2 = [int]$sidecar.metrics.backlog

    $stage = "extend month trend charts"
    # The Intake/Resolved/Backlog charts plot the month table with fixed ranges
    # (e.g. Charts!$A$32:$A$38). Extend any such range that stops short of the
    # row just written so a rolled-forward month appears on the charts. Ranges
    # that already reach $metricsRow are left untouched, keeping re-runs safe.
    # Single-quoted literal: \$ must reach the regex engine as an escaped dollar.
    $monthRangePattern = '(''?Charts''?!\$[A-D]\$32:\$[A-D]\$)(\d+)'
    $extendEvaluator = [System.Text.RegularExpressions.MatchEvaluator]{
        param($rangeMatch)
        if ([int]$rangeMatch.Groups[2].Value -lt $metricsRow) {
            return $rangeMatch.Groups[1].Value + $metricsRow
        }
        return $rangeMatch.Value
    }
    foreach ($chartObject in @($chartsSheet.ChartObjects())) {
        foreach ($series in @($chartObject.Chart.SeriesCollection())) {
            $seriesFormula = [string]$series.Formula
            $extendedFormula = [regex]::Replace($seriesFormula, $monthRangePattern, $extendEvaluator)
            if ($extendedFormula -ne $seriesFormula) {
                $series.Formula = $extendedFormula
            }
        }
    }

    $stage = "calculate workbook"
    $excel.CalculateFullRebuild()
    $stage = "save workbook"
    $workbook.Save()
    Write-Output "Workbook updated: $workbookPath"
    Write-Output "Incident rows: $($lastRow - 1)"
    Write-Output "Local pivots refreshed: $refreshedPivots"
    Write-Output "Review rows: $($reviewRange.Rows.Count - 1)"
}
catch {
    throw "Excel refresh failed during '$stage': $($_.Exception.Message)"
}
finally {
    if ($null -ne $workbook) {
        try { $workbook.Close($false) } catch { Write-Warning "Could not close analysis workbook cleanly." }
    }
    if ($null -ne $stagingWorkbook) {
        try { $stagingWorkbook.Close($false) } catch { Write-Warning "Could not close staging workbook cleanly." }
    }
    try { $excel.Quit() } catch { Write-Warning "Could not close Excel cleanly." }
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}