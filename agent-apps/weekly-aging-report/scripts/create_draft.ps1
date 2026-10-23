<#
Weekly Aging Report - Outlook draft creation.

Builds the HTML body - the same Deloitte x Takeda co-branded styling as the
weekly backlog report (Takeda red accent, logos from ../../shared/assets) -
from output/email-data.json, creates a new Outlook mail item with the same
fixed To/Cc as the backlog report and this report's own subject pattern,
attaches the processed workbook, and displays it as a draft for the user to
review. It does NOT send - run send_draft.ps1 separately after the user
confirms in chat.

Most "Assigned to" names already have a vetted email from build_email_data.py
(joined against ../../shared/roster/Names.xlsx) - for those, this script
resolves the polished "@Last, First" Exchange display text from that email
(Session.CreateRecipient(email).Resolve()), same method the backlog report
uses. Names with no roster match fall back to a direct Exchange lookup by
name text (Session.CreateRecipient(name).Resolve()), which is less reliable
since ServiceNow's "Assigned to" spelling doesn't always match the
directory's display name. A name that fails both falls back to plain text
(flagged in the script's output for the user to check).

Usage: powershell -File create_draft.ps1 -DataPath "...\output\email-data.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$DataPath
)

$ErrorActionPreference = "Stop"

$data = Get-Content -Raw -Path $DataPath | ConvertFrom-Json

$To = "USPDTOperate <uspdtoperate@deloitte.com>"
$Cc = "Peethambaram, Sreela <speethambaram@deloitte.com>; Atchula, Rupavani <ratchula@deloitte.com>; Sarab, Mani Deep <msarab@deloitte.com>"
$Subject = "Aging Incidents | Last updated before $($data.date_str_subject)"

$olMailItem = 0
$olText = 1
$draftTokenPropertyName = "AI OS Draft Token"
$draftToken = [guid]::NewGuid().ToString("N")
$draftTokenPath = Join-Path $PSScriptRoot "..\output\draft-entry-id.txt"

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")

function Resolve-Recipient($nameOrEmail) {
    try {
        $recip = $namespace.CreateRecipient($nameOrEmail)
        [void]$recip.Resolve()
        if ($recip.Resolved) {
            $exUser = $recip.AddressEntry.GetExchangeUser()
            if ($exUser) {
                return @{ Name = $recip.Name; Email = $exUser.PrimarySmtpAddress }
            }
        }
    } catch {}
    return $null
}

function Resolve-Assignee($row) {
    # Prefer the roster-vetted email (build_email_data.py) - resolving by
    # email gives the same reliable "@Last, First" display text the backlog
    # report uses. Only fall back to resolving by raw ServiceNow name text
    # when the person isn't on the roster.
    if ($row.email) {
        $byEmail = Resolve-Recipient $row.email
        if ($byEmail) { return $byEmail }
    }
    return Resolve-Recipient $row.label
}

# Same Deloitte x Takeda co-brand as the weekly backlog report - shared so
# both reports look identical when sent back to back.
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

$unresolved = New-Object System.Collections.Generic.List[string]
$rowsHtml = New-Object System.Collections.Generic.List[string]

# Header row (Row Labels / Count of Number) - Takeda red, white text
$headerCells = (Cell "Row Labels" "border:solid $takedaRed 1.0pt;background:$takedaRed;padding:0in 5.4pt 0in 5.4pt;height:.26in" $true $false "#FFFFFF") +
               (Cell "Count of Number" "border:solid $takedaRed 1.0pt;background:$takedaRed;padding:0in 5.4pt 0in 5.4pt;height:.26in" $true $true "#FFFFFF")
$rowsHtml.Add("<tr style='height:.26in'>$headerCells</tr>")

foreach ($row in $data.rows) {
    if ($row.type -eq "priority" -or $row.type -eq "grand_total") {
        $isGrand = $row.type -eq "grand_total"
        $bg = if ($isGrand) { $redTint } else { $grayTint }
        $topBorder = if ($isGrand) { "border-top:solid $takedaRed 1.5pt;" } else { "" }
        $labelCell = Cell $row.label "$firstCellStyleNoBg;background:$bg;$topBorder" $true $false $null
        $valueCell = Cell $row.count "$cellStyle;background:$bg;$topBorder" $true $true $null
        $rowsHtml.Add("<tr style='height:.22in'>$labelCell$valueCell</tr>")
    }
    elseif ($row.type -eq "name") {
        $resolved = Resolve-Assignee $row
        if ($resolved) {
            $mention = "<a href=`"mailto:$($resolved.Email)`"><span style=`"font-family:'Aptos Narrow',sans-serif;text-decoration:none`">@$($resolved.Name)</span></a>"
        } else {
            $unresolved.Add($row.label)
            $mention = $row.label
        }
        $labelCell = "<td nowrap valign=bottom style='$firstCellStyleNoBg'><p class=MsoNormal style='text-indent:11.0pt'><b><span style=`"$font`">$mention</span></b></p></td>"
        $valueCell = Cell $row.count $cellStyle $true $true $null
        $rowsHtml.Add("<tr style='height:.22in'>$labelCell$valueCell</tr>")
    }
    else {
        # date row
        $labelCell = "<td nowrap valign=bottom style='$firstCellStyleNoBg'><p class=MsoNormal style='text-indent:22.0pt'><span style=`"$font`">$($row.label)</span></p></td>"
        $valueCell = Cell $row.count $cellStyle $false $true $null
        $rowsHtml.Add("<tr style='height:.22in'>$labelCell$valueCell</tr>")
    }
}

if ($unresolved.Count -gt 0) {
    Write-Warning "Could not resolve these names against the Exchange directory (shown as plain text, no mailto link): $($unresolved -join ', ')"
}

$tableHtml = "<table class=MsoNormalTable border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:solid $borderGray 1.0pt'>" + ($rowsHtml -join "") + "</table>"

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
<p class=MsoNormal><span style="font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:$textColor">Please find below the list of <b>$($data.grand_total) incidents</b> that were last updated prior to <b>$($data.date_str_full)</b>. We request that the assigned owners <b>prioritize review and next steps</b> for these items.</span><o:p></o:p></p>
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
# renders the img tags as broken.
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
