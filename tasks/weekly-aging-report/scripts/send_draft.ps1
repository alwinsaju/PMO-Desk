<#
Weekly Aging Report - sends a draft created by create_draft.ps1.

Only run this after the user has explicitly confirmed the draft in chat -
this performs the actual send, on the user's behalf, via their Outlook
desktop app.

Usage: powershell -File send_draft.ps1 -DraftToken "<token from create_draft.ps1>"
#>
param(
    [Parameter(Mandatory = $true)][Alias("EntryId")][string]$DraftToken
)

$ErrorActionPreference = "Stop"

$olFolderDrafts = 16
$olMail = 43
$draftTokenPropertyName = "PMO Desk Draft Token"

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")

function Get-DraftByToken($token) {
    $matches = New-Object System.Collections.Generic.List[object]
    $drafts = $namespace.GetDefaultFolder($olFolderDrafts).Items

    for ($index = 1; $index -le $drafts.Count; $index++) {
        $item = $drafts.Item($index)
        if ($item.Class -ne $olMail) { continue }

        $property = $item.UserProperties.Find($draftTokenPropertyName)
        if ($property -and $property.Value -eq $token) {
            $matches.Add($item)
        }
    }

    if ($matches.Count -eq 0) {
        throw "No Outlook draft has the expected PMO Desk draft token. It may have been deleted or moved out of Drafts."
    }
    if ($matches.Count -gt 1) {
        throw "More than one Outlook draft has the expected PMO Desk draft token. No message was sent."
    }
    return $matches[0]
}

function Get-LegacyDraft($entryId) {
    try {
        return $namespace.GetItemFromID($entryId)
    } catch [System.Runtime.InteropServices.COMException] {
        # Older runs stored an Outlook EntryID, which can change after a user
        # opens or edits a draft. Recover only if the current report identifies
        # exactly one matching draft by subject and workbook attachment.
    }

    $emailDataPath = Join-Path $PSScriptRoot "..\output\email-data.json"
    $data = Get-Content -Raw -Path $emailDataPath | ConvertFrom-Json
    $expectedSubject = "Aging Incidents | Last updated before $($data.date_str_subject)"
    $expectedAttachment = [System.IO.Path]::GetFileName($data.workbook_path)
    $matches = New-Object System.Collections.Generic.List[object]
    $drafts = $namespace.GetDefaultFolder($olFolderDrafts).Items

    for ($index = 1; $index -le $drafts.Count; $index++) {
        $item = $drafts.Item($index)
        if ($item.Class -ne $olMail -or $item.Subject -ne $expectedSubject) { continue }

        for ($attachmentIndex = 1; $attachmentIndex -le $item.Attachments.Count; $attachmentIndex++) {
            if ($item.Attachments.Item($attachmentIndex).FileName -eq $expectedAttachment) {
                $matches.Add($item)
                break
            }
        }
    }

    if ($matches.Count -eq 0) {
        throw "The stored Outlook EntryID is stale and no matching aging-report draft was found in Drafts. No message was sent."
    }
    if ($matches.Count -gt 1) {
        throw "The stored Outlook EntryID is stale and multiple matching aging-report drafts were found. No message was sent."
    }
    return $matches[0]
}

$mail = $null
try {
    if ($DraftToken -match "^[0-9a-fA-F]{32}$") {
        $mail = Get-DraftByToken $DraftToken
    } else {
        $mail = Get-LegacyDraft $DraftToken
    }

    if ($mail.Recipients.Count -eq 0 -or -not $mail.Recipients.ResolveAll()) {
        throw "One or more recipients could not be resolved. Review the draft in Outlook before trying again."
    }

    $subject = $mail.Subject
    $mail.Save()
    $mail.Send()
    Write-Output "Sent: $subject"
} catch {
    $hResult = "0x{0:X8}" -f $_.Exception.HResult
    $subjectContext = if ($mail) { " for '$($mail.Subject)'" } else { "" }
    throw "Outlook could not send the aging-report draft$subjectContext. $($_.Exception.Message) (HRESULT $hResult)"
}
