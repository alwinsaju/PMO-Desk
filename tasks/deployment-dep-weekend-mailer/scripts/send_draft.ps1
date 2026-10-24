<#
Deployment & DEP Weekend Activities Mailer - sends a draft created by
create_draft.ps1.

Only run this after the user has explicitly confirmed the draft in chat -
this performs the actual send, on the user's behalf, via their Outlook
desktop app.

Usage: powershell -File send_draft.ps1 -EntryId "<id from create_draft.ps1>"
#>
param(
    [Parameter(Mandatory = $true)][string]$EntryId
)

$ErrorActionPreference = "Stop"

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$mail = $namespace.GetItemFromID($EntryId)
$mail.Send()
Write-Output "Sent: $($mail.Subject)"
