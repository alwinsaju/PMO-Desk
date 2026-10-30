<#
Mailer from a table - Outlook draft creation.

Reads output/email-data.json (written by build_email_data.py), creates a new Outlook
mail item with the message and the table, saves it as a draft and writes a draft token
to output/draft-entry-id.txt so send_draft.ps1 can find exactly this draft later.
It does NOT send.

Usage: powershell -File create_draft.ps1 -DataPath "...\output\email-data.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$DataPath
)

$ErrorActionPreference = "Stop"

$data = Get-Content -Raw -Path $DataPath | ConvertFrom-Json

$olMailItem = 0
$draftTokenPropertyName = "AI OS Draft Token"
$olText = 1
$draftToken = [guid]::NewGuid().ToString("N")
$draftTokenPath = Join-Path $PSScriptRoot "..\output\draft-entry-id.txt"

$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem($olMailItem)

if ($data.to) { $mail.To = [string]$data.to }
if ($data.cc) { $mail.CC = [string]$data.cc }
$mail.Subject = [string]$data.subject

$tokenProperty = $mail.UserProperties.Add($draftTokenPropertyName, $olText)
$tokenProperty.Value = $draftToken

$existingBody = $mail.HTMLBody
$contentHtml = [string]$data.body_html + "<p></p>" + [string]$data.table_html

foreach ($attachment in @($data.attachments)) {
    if ($attachment -and (Test-Path -LiteralPath $attachment)) {
        $mail.Attachments.Add([string]$attachment) | Out-Null
    }
}

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
