<#
Mailer from a table - sends the draft created by create_draft.ps1.

Only the Tasks app runs this, after the person has reviewed the draft and confirmed.

Usage: powershell -File send_draft.ps1 -DraftToken "<token from create_draft.ps1>"
#>
param(
    [Parameter(Mandatory = $true)][Alias("EntryId")][string]$DraftToken
)

$ErrorActionPreference = "Stop"

$olFolderDrafts = 16
$olMail = 43
$draftTokenPropertyName = "PMO Desk Draft Token"

if ($DraftToken -notmatch "^[0-9a-fA-F]{32}$") {
    throw "The draft token is not valid. No message was sent."
}

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")

$matches = New-Object System.Collections.Generic.List[object]
$drafts = $namespace.GetDefaultFolder($olFolderDrafts).Items
for ($index = 1; $index -le $drafts.Count; $index++) {
    $item = $drafts.Item($index)
    if ($item.Class -ne $olMail) { continue }
    $property = $item.UserProperties.Find($draftTokenPropertyName)
    if ($property -and $property.Value -eq $DraftToken) { $matches.Add($item) }
}

if ($matches.Count -eq 0) {
    throw "No Outlook draft has the expected PMO Desk draft token. It may have been deleted or moved out of Drafts."
}
if ($matches.Count -gt 1) {
    throw "More than one Outlook draft has the expected PMO Desk draft token. No message was sent."
}

$mail = $matches[0]
if ($mail.Recipients.Count -eq 0 -or -not $mail.Recipients.ResolveAll()) {
    throw "One or more recipients could not be resolved. Review the draft in Outlook before trying again."
}

$subject = $mail.Subject
$mail.Save()
$mail.Send()
Write-Output "Sent: $subject"
