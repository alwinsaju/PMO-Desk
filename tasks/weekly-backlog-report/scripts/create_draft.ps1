<#
Weekly Backlog Report - Outlook draft creation.

Builds the HTML body - a Deloitte x Takeda co-branded table (Takeda red
accent/palette, matching reference/Outage_Availability_Report_Template_1.pptx,
plus a Deloitte + Takeda logo lockup header, logos from assets/) - from
output/email-data.json, creates a new Outlook mail item with the same fixed
To/Cc and subject pattern as the reference email, attaches the processed
workbook, and displays it as a draft for the user to review. It does NOT
send - run send_draft.ps1 separately after the user confirms in chat.

Each name's "@Last, First" display text is resolved live against the
Exchange directory (Session.CreateRecipient(email).Resolve()) rather than
guessed from the roster name, since the reference email's display format
doesn't follow any fixed rule the roster name could be parsed into.

Usage: powershell -File create_draft.ps1 -DataPath "...\output\email-data.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$DataPath
)

$ErrorActionPreference = "Stop"

$data = Get-Content -Raw -Path $DataPath | ConvertFrom-Json

$To = if ($data.to) { $data.to } else { "USPDTOperate <uspdtoperate@deloitte.com>" }
$Cc = if ($data.cc) { $data.cc } else { "Peethambaram, Sreela <speethambaram@deloitte.com>; Atchula, Rupavani <ratchula@deloitte.com>; Sarab, Mani Deep <msarab@deloitte.com>" }
$Subject = if ($data.subject) { $data.subject } else { "Backlog Incidents | $($data.date_str)" }

$olMailItem = 0
$olText = 1
$draftTokenPropertyName = "AI OS Draft Token"
$draftToken = [guid]::NewGuid().ToString("N")
$draftTokenPath = Join-Path $PSScriptRoot "..\output\draft-entry-id.txt"

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

# Deloitte x Takeda co-brand: colors match this engagement's own reference
# template (reference/Outage_Availability_Report_Template_1.pptx) - Takeda
# red as the primary accent, charcoal text, light neutral grays - rather than
# generic Deloitte green, since this report is styled for the Takeda account.
$takedaRed = "#E1242A"
$redTint = "#FBE6E7"
$grayTint = "#F5F5F7"
$borderGray = "#D9D9D9"
$textColor = "#2D2D2D"

$deloitteLogoPath = Join-Path $PSScriptRoot "..\..\shared\assets\deloitte-logo.png"
$takedaLogoPath = Join-Path $PSScriptRoot "..\..\shared\assets\takeda-logo.png"

$cellStyle = "border-top:none;border-left:none;border-bottom:solid $borderGray 1.0pt;border-right:solid $borderGray 1.0pt;padding:0in 5.4pt 0in 5.4pt;height:.22in"
$firstCellStyleNoBg = "border:solid $borderGray 1.0pt;border-top:none;padding:0in 5.4pt 0in 5.4pt;height:.22in"
$font = "font-size:10.5pt;font-family:'Aptos Narrow',sans-serif;color:$textColor"

function Cell($html, $style, $bold, $rightAlign, $color) {
    $cellTextColor = if ($color) { $color } else { $textColor }
    $span = "<span style=`"font-size:10.5pt;font-family:'Aptos Narrow',sans-serif;color:$cellTextColor`">$html</span>"
    if ($bold) { $span = "<b>$span</b>" }
    $align = if ($rightAlign) { " align=right style='text-align:right'" } else { "" }
    return "<td nowrap valign=bottom style='$style'><p class=MsoNormal$align>$span</p></td>"
}

$rowsHtml = New-Object System.Collections.Generic.List[string]

# Header row (Row Labels / bucket columns / Grand Total) - Takeda red, white text
$headers = @("Row Labels", "15-30 days", "31-45 days", ">45 days", "Grand Total")
$headerCells = ""
foreach ($h in $headers) {
    $headerCells += Cell $h "border:solid $takedaRed 1.0pt;background:$takedaRed;padding:0in 5.4pt 0in 5.4pt;height:.26in" $true $false "#FFFFFF"
}
$rowsHtml.Add("<tr style='height:.26in'>$headerCells</tr>")

foreach ($row in $data.rows) {
    if ($row.type -eq "priority" -or $row.type -eq "grand_total") {
        $isGrand = $row.type -eq "grand_total"
        $bg = if ($isGrand) { $redTint } else { $grayTint }
        $topBorder = if ($isGrand) { "border-top:solid $takedaRed 1.5pt;" } else { "" }
        $firstStyle = "$firstCellStyleNoBg;background:$bg;$topBorder"
        $labelCell = Cell $row.label $firstStyle $true $false $null
        $valueCells = ""
        foreach ($v in ($row.values + @($row.total))) {
            $style = "$cellStyle;background:$bg;$topBorder"
            $valueCells += Cell $v $style $true $true $null
        }
        $rowsHtml.Add("<tr style='height:.22in'>$labelCell$valueCells</tr>")
    }
    else {
        $displayName = Resolve-DisplayName $row.email $row.label
        $mention = "<a href=`"mailto:$($row.email)`"><span style=`"font-family:'Aptos Narrow',sans-serif;text-decoration:none`">@$displayName</span></a>"
        $labelCell = "<td nowrap valign=bottom style='$firstCellStyleNoBg'><p class=MsoNormal style='text-indent:11.0pt'><span style=`"$font`">$mention</span></p></td>"
        $valueCells = ""
        foreach ($v in ($row.values + @($row.total))) {
            $valueCells += Cell $v $cellStyle $false $true $null
        }
        $rowsHtml.Add("<tr style='height:.22in'>$labelCell$valueCells</tr>")
    }
}

$tableHtml = "<table class=MsoNormalTable border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:solid $borderGray 1.0pt'>" + ($rowsHtml -join "") + "</table>"

# Co-brand header: Deloitte logo | divider | Takeda logo, with a thin red
# rule underneath (a letterhead lockup, not a full-width accent stripe).
$logoBar = @"
<table cellspacing=0 cellpadding=0 style='border-collapse:collapse'>
<tr>
<td style='padding:0 12pt 0 0'><img src="cid:logo_deloitte" alt="Deloitte" width="112" height="22"></td>
<td style='border-left:solid $borderGray 1.0pt;padding:0 0 0 12pt'><img src="cid:logo_takeda" alt="Takeda" width="60" height="22"></td>
</tr>
</table>
<table cellspacing=0 cellpadding=0 style='border-collapse:collapse;width:100%;margin-top:6pt'><tr><td style='background:$takedaRed;height:2pt;line-height:2pt;font-size:1pt'>&nbsp;</td></tr></table>
"@

$contentHtml = @"
<div class=WordSection1>
$logoBar
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
<p class=MsoNormal><span style="font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:$textColor">Hi Team,</span><o:p></o:p></p>
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
<p class=MsoNormal><span style="font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:$textColor">Please see below the current backlog of <b>$($data.grand_total) incidents</b> aged <b>more than 15 days</b>. We request that assignees <b>prioritize review and remediation</b> of these items.</span><o:p></o:p></p>
<p class=MsoNormal><span style="font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:$textColor">The <b>Incident Backlog</b> sheet is attached and includes the full list of incidents and relevant details for reference.</span><o:p></o:p></p>
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
$tableHtml
<p class=MsoNormal>&nbsp;<o:p></o:p></p>
</div>
"@

$mail = $outlook.CreateItem($olMailItem)
$mail.To = $To
$mail.CC = $Cc
$mail.Subject = $Subject
$mail.UserProperties.Add($draftTokenPropertyName, $olText, $true).Value = $draftToken
$mail.Display()  # triggers the user's default "new message" signature into HTMLBody, if configured
Start-Sleep -Milliseconds 500

$existingBody = $mail.HTMLBody

# Attachments (incl. the cid-referenced inline logos) must exist BEFORE the
# HTMLBody that references them is set, or the open Inspector's editor
# renders the img tags as broken - it doesn't re-resolve cid: references
# against attachments added after the body was last assigned.
$PR_ATTACH_CONTENT_ID = "http://schemas.microsoft.com/mapi/proptag/0x3712001F"
$olByValue = 1

$deloitteAttachment = $mail.Attachments.Add($deloitteLogoPath, $olByValue, 0, "Deloitte logo")
$deloitteAttachment.PropertyAccessor.SetProperty($PR_ATTACH_CONTENT_ID, "logo_deloitte")

$takedaAttachment = $mail.Attachments.Add($takedaLogoPath, $olByValue, 0, "Takeda logo")
$takedaAttachment.PropertyAccessor.SetProperty($PR_ATTACH_CONTENT_ID, "logo_takeda")

$mail.Attachments.Add($data.workbook_path) | Out-Null

$bodyOpenMatch = [regex]::Match($existingBody, "<body[^>]*>")
if ($bodyOpenMatch.Success) {
    $insertAt = $bodyOpenMatch.Index + $bodyOpenMatch.Length
    $newBody = $existingBody.Substring(0, $insertAt) + $contentHtml + $existingBody.Substring($insertAt)
} else {
    $newBody = $contentHtml + $existingBody
}
$mail.HTMLBody = $newBody

$mail.Save()
[System.IO.File]::WriteAllText($draftTokenPath, $draftToken, [System.Text.Encoding]::ASCII)
Write-Output "Draft created. Draft token: $draftToken"
