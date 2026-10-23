<#
Deployment & DEP Weekend Activities Mailer - Outlook draft creation.

Builds two HTML tables from output/email-data.json - this week's Deployment
Activities block and the standing recurring Activities schedule - styled
with the same Deloitte x Takeda co-branding as weekly-backlog-report and
weekly-aging-report (Takeda red table headers, Deloitte + Takeda logo
lockup), rather than the plain green header the mailer used before this
agent existed. Creates a new Outlook mail item with the same fixed To/Cc as
the other two reports, and displays it as a draft for the user to review.
It does NOT send - run send_draft.ps1 separately after the user confirms in
chat. No workbook attachment - the prior real-world example of this mailer
didn't attach one either, just the table in the body.

Each person's "@Last, First" display text is resolved live against the
Exchange directory (Session.CreateRecipient(email).Resolve()), same as the
other two agents. A name build_email_data.py couldn't resolve against the
roster renders as plain text instead of a mention link - flagged in that
script's console output for the user to check before sending.

Usage: powershell -File create_draft.ps1 -DataPath "...\output\email-data.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$DataPath
)

$ErrorActionPreference = "Stop"

$data = Get-Content -Raw -Path $DataPath | ConvertFrom-Json

$To = "USPDTOperate <uspdtoperate@deloitte.com>"
$Cc = "Peethambaram, Sreela <speethambaram@deloitte.com>; Sarab, Mani Deep <msarab@deloitte.com>; Atchula, Rupavani <ratchula@deloitte.com>"
$Subject = "Deployment and POC Details $($data.date_str) & DEP Team Schedule"

$olMailItem = 0

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")

function Resolve-DisplayName($email, $fallbackLabel) {
    try {
        $recip = $namespace.CreateRecipient($email)
        [void]$recip.Resolve()
        if ($recip.Resolved) {
            return $recip.Name
        }
    } catch {}
    return $fallbackLabel
}

function Mention($person) {
    if ($person.email) {
        $display = Resolve-DisplayName $person.email $person.name
        return "<a href=`"mailto:$($person.email)`"><span style=`"font-family:'Aptos Narrow',sans-serif;text-decoration:none`">@$display</span></a>"
    }
    return $person.name
}

function People($people) {
    return (($people | ForEach-Object { Mention $_ }) -join "/")
}

# Deloitte x Takeda co-brand: same palette/logos as weekly-backlog-report and
# weekly-aging-report - this mailer goes to the same distribution list off
# the same engagement, so it should look like it comes from the same source.
$takedaRed = "#E1242A"
$grayTint = "#F5F5F7"
$borderGray = "#D9D9D9"
$textColor = "#2D2D2D"

$deloitteLogoPath = Join-Path $PSScriptRoot "..\..\shared\assets\deloitte-logo.png"
$takedaLogoPath = Join-Path $PSScriptRoot "..\..\shared\assets\takeda-logo.png"

$cellStyle = "border:solid $borderGray 1.0pt;padding:0in 5.4pt 0in 5.4pt;height:.22in"

function Cell($html, $bold, $center, $rowspan, $colspan, $bg, $color) {
    $c = if ($color) { $color } else { $textColor }
    $span = "<span style=`"font-size:10.5pt;font-family:'Aptos Narrow',sans-serif;color:$c`">$html</span>"
    if ($bold) { $span = "<b>$span</b>" }
    $align = if ($center) { " align=center style='text-align:center'" } else { "" }
    $rs = if ($rowspan -and $rowspan -gt 1) { " rowspan=$rowspan" } else { "" }
    $cs = if ($colspan -and $colspan -gt 1) { " colspan=$colspan" } else { "" }
    $style = $cellStyle
    if ($bg) { $style = "$style;background:$bg" }
    return "<td$rs$cs valign=top style='$style'><p class=MsoNormal$align>$span</p></td>"
}

function HeaderRow($labels) {
    $cells = ($labels | ForEach-Object { Cell $_ $true $true $null $null $takedaRed "#FFFFFF" }) -join ""
    return "<tr>$cells</tr>"
}

# --- Table 1: this week's Deployment Activities block ---
$deployRows = New-Object System.Collections.Generic.List[string]
$deployRows.Add("<tr>$(Cell $data.block_title $true $true $null 5 $takedaRed '#FFFFFF')</tr>")
$deployRows.Add((HeaderRow @("Day", "Date", "Time (IST)", "Activity", "Point Of Contact")))

foreach ($row in $data.deployment_rows) {
    $cells = ""
    if ($row.rowspan -gt 0) {
        $cells += Cell $row.day $false $true $row.rowspan $null $null
        $cells += Cell $row.date $false $true $row.rowspan $null $null
    }
    $cells += Cell $row.time $false $true $null $null $null
    $cells += Cell $row.activity $false $false $null $null $null
    $pocHtml = People $row.people
    foreach ($extra in @($row.extras)) {
        if ($extra) { $pocHtml += "<br>$($extra.label) - $(People $extra.people)" }
    }
    $cells += Cell $pocHtml $false $true $null $null $null
    $deployRows.Add("<tr>$cells</tr>")
}
$deployTableHtml = "<table class=MsoNormalTable border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:solid $borderGray 1.0pt'>" + ($deployRows -join "") + "</table>"

# --- Table 2: standing recurring Activities schedule ---
$activityRows = New-Object System.Collections.Generic.List[string]
$activityRows.Add((HeaderRow @("Activity", "Day", "Time", "Assignee")))

foreach ($row in $data.activities_rows) {
    if ($row.type -eq "section") {
        $activityRows.Add("<tr>$(Cell $row.label $true $true $null 4 $grayTint)</tr>")
        continue
    }
    $cells = ""
    if ($row.rowspan -gt 0) {
        $cells += Cell $row.activity $false $false $row.rowspan $null $null
    }
    $cells += Cell $row.day $false $false $null $null $null
    $cells += Cell $row.time $false $false $null $null $null
    $cells += Cell (People $row.people) $false $true $null $null $null
    $activityRows.Add("<tr>$cells</tr>")
}
$activityTableHtml = "<table class=MsoNormalTable border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:solid $borderGray 1.0pt'>" + ($activityRows -join "") + "</table>"

# Co-brand header: Deloitte logo | divider | Takeda logo, with a thin red
# rule underneath - same lockup as the other two agents.
$logoBar = @"
<table cellspacing=0 cellpadding=0 style='border-collapse:collapse'>
<tr>
<td style='padding:0 12pt 0 0'><img src="cid:logo_deloitte" alt="Deloitte" width="112" height="22"></td>
<td style='border-left:solid $borderGray 1.0pt;padding:0 0 0 12pt'><img src="cid:logo_takeda" alt="Takeda" width="60" height="22"></td>
</tr>
</table>
<table cellspacing=0 cellpadding=0 style='border-collapse:collapse;width:100%;margin-top:6pt'><tr><td style='background:$takedaRed;height:2pt;line-height:2pt;font-size:1pt'>&nbsp;</td></tr></table>
"@

if ($data.body_date.single) {
    $bodyDateHtml = "<b><span style='color:black'>$($data.body_date.day)<sup>$($data.body_date.suffix)</sup> $($data.body_date.month)</span></b>"
} else {
    $bodyDateHtml = "<b><span style='color:black'>$($data.body_date.range_text)</span></b>"
}

$contentHtml = @"
<div class=WordSection1>
$logoBar
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
<p class=MsoNormal><span style="font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:$textColor">Hi Team,</span><o:p></o:p></p>
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
<p class=MsoNormal><span style="font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:$textColor">Please find below, the deployment and POC details for $bodyDateHtml</span><o:p></o:p></p>
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
$deployTableHtml
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
$activityTableHtml
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
</div>
"@

$mail = $outlook.CreateItem($olMailItem)
$mail.To = $To
$mail.CC = $Cc
$mail.Subject = $Subject
$mail.Display()  # triggers the user's default "new message" signature into HTMLBody, if configured
Start-Sleep -Milliseconds 500

$existingBody = $mail.HTMLBody

# Attachments (incl. the cid-referenced inline logos) must exist BEFORE the
# HTMLBody that references them is set, or the open Inspector shows broken
# images - same Outlook COM gotcha as the other two agents.
$PR_ATTACH_CONTENT_ID = "http://schemas.microsoft.com/mapi/proptag/0x3712001F"
$olByValue = 1

$deloitteAttachment = $mail.Attachments.Add($deloitteLogoPath, $olByValue, 0, "Deloitte logo")
$deloitteAttachment.PropertyAccessor.SetProperty($PR_ATTACH_CONTENT_ID, "logo_deloitte")

$takedaAttachment = $mail.Attachments.Add($takedaLogoPath, $olByValue, 0, "Takeda logo")
$takedaAttachment.PropertyAccessor.SetProperty($PR_ATTACH_CONTENT_ID, "logo_takeda")

$bodyOpenMatch = [regex]::Match($existingBody, "<body[^>]*>")
if ($bodyOpenMatch.Success) {
    $insertAt = $bodyOpenMatch.Index + $bodyOpenMatch.Length
    $newBody = $existingBody.Substring(0, $insertAt) + $contentHtml + $existingBody.Substring($insertAt)
} else {
    $newBody = $contentHtml + $existingBody
}
$mail.HTMLBody = $newBody

$mail.Save()

$entryId = $mail.EntryID
Write-Output "Draft created. EntryID: $entryId"

$outputDir = Join-Path $PSScriptRoot "..\output"
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir | Out-Null }
Set-Content -Path (Join-Path $outputDir "draft-entry-id.txt") -Value $entryId -NoNewline
