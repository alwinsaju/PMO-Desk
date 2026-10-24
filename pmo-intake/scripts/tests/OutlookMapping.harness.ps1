<#
.SYNOPSIS
  Feeds FAKE Outlook items (plain PSCustomObjects) through OutlookMapping.ps1
  and writes the results to a JSON file for src/lib/pmo/outlookExport.test.mjs
  to validate. It never starts Outlook and never touches a mailbox: there is no
  COM object anywhere in here, only fictional data.

.PARAMETER OutFile
  Where to write the results (UTF-8, no BOM). A file rather than stdout so the
  console code page cannot mangle non-ASCII text.

  ASCII only (Windows PowerShell 5.1 reads a BOM-less script as ANSI): the
  non-ASCII test characters are built from code points.
#>
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'OutlookMapping.ps1')

. (Join-Path $PSScriptRoot 'FakeOutlook.ps1')

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$eAcute = [string][char]0x00E9
$emDash = [string][char]0x2014
$euro = [string][char]0x20AC

# --- cases -------------------------------------------------------------------

$results = New-Object System.Collections.ArrayList

function Add-Case([string]$Name, $Item, [hashtable]$Options = @{}) {
  $mapped = ConvertTo-PmoIntake -Item $Item @Options
  $row = [ordered]@{
    name        = $Name
    skipped     = [bool]$mapped.Skipped
    skipReason  = $mapped.SkipReason
    warnings    = [string[]]@($mapped.Warnings)
    guardDenied = [bool]$mapped.GuardDenied
  }
  if (-not $mapped.Skipped) {
    $row['json'] = ConvertTo-IntakeFileText -Intake $mapped.Intake
    $row['fileName'] = Get-IntakeFileName -SourceId $mapped.SourceId -ReceivedUtc $mapped.ReceivedUtc
    $row['sourceId'] = $mapped.SourceId
    $row['expectedUtc'] = $mapped.ReceivedUtc.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
  }
  [void]$results.Add($row)
}

# 1. Plain SMTP mail; a body full of quotes, backslashes and non-ASCII text;
#    attachments (one inline logo that must be skipped, one with only an
#    extension to go on); high importance.
$quoted = 'She said "send it" and wrote C:\temp\raid.xlsx; caf' + $eAcute + ' ' + $emDash + ' 5' + $euro + "`r`nline two"
Add-Case 'plain-smtp' (New-FakeMail @{
    Body        = $quoted
    Importance  = 2
    Attachments = @(
      (New-Object psobject -Property @{ FileName = 'RAID log.pdf'; DisplayName = 'RAID log.pdf'; Size = 48213; PropertyAccessor = (New-Accessor @{ $script:PrAttachMimeTag = 'application/pdf'; $script:PrAttachmentHidden = $false }) }),
      (New-Object psobject -Property @{ FileName = 'image001.png'; DisplayName = 'image001.png'; Size = 1200; PropertyAccessor = (New-Accessor @{ $script:PrAttachmentHidden = $true }) }),
      (New-Object psobject -Property @{ FileName = 'plan.xlsx'; DisplayName = 'plan.xlsx'; Size = 9000; PropertyAccessor = (New-Accessor @{}) })
    )
  })

# 2. Exchange sender and recipients (X500 addresses): resolved through
#    GetExchangeUser, and through the MAPI SMTP property when that returns null.
Add-Case 'x500-resolved' (New-FakeMail @{
    SenderEmailAddress = $xPat
    SenderEmailType    = 'EX'
    Sender             = (New-AddressEntry 'EX' 'pat.sample@deloitte.com')
    Recipients         = @(
      (New-Recipient 'Alwin Saju' $xPat 1 (New-AddressEntry 'EX' 'alsaju@deloitte.com') (New-Accessor @{})),
      (New-Recipient 'Jordan Sample' $xJordan 2 (New-AddressEntry 'EX' $null) (New-Accessor @{ $script:PrSmtpAddress = 'jordan.sample@deloitte.com' })),
      (New-Recipient 'Hidden Copy' 'hidden@deloitte.com' 3 (New-AddressEntry 'SMTP' $null) $null)
    )
  })

# 3. Exchange sender that cannot be resolved at all: no address, a warning, and
#    still a valid intake (the app's filter will quarantine it with a reason).
Add-Case 'x500-unresolved' (New-FakeMail @{
    SenderEmailAddress = $xPat
    SenderEmailType    = 'EX'
    Sender             = (New-AddressEntry 'EX' $null -Throws)
    PropertyAccessor   = (New-Accessor @{ $script:PrInternetMessageId = '<fake-0003@example.test>'; $script:PrSenderSmtpAddress = (New-ComError 'nope' -2147221233) })
    Recipients         = @((New-Recipient 'Alwin Saju' $xPat 1 (New-AddressEntry 'EX' $null -Throws) (New-Accessor @{})))
  })

# 4. HTML-only body.
Add-Case 'html-only' (New-FakeMail @{
    Body     = ''
    HTMLBody = '<html><head><style>p {color:red}</style></head><body><!--[if gte mso 9]><xml>junk</xml><![endif]--><p>Hi all,</p><p>FYI the steering committee moved to Thursday &amp; the invite is updated.<br>Thanks,<br>Jordan</p></body></html>'
  })

# 5. The guard prompt denied (E_ABORT) while resolving an Exchange sender: the
#    run is told so (GuardDenied), and the message still maps. (PowerShell
#    swallows an exception thrown by a plain property getter on a fake, so the
#    denial is staged on method calls, which do propagate, exactly like the
#    GetExchangeUser() and GetProperty() calls it guards in real Outlook.)
$denied = [System.Runtime.InteropServices.COMException]::new('Operation aborted', -2147467260)
Add-Case 'guard-denied' (New-FakeMail @{
    SenderEmailAddress = $xPat
    SenderEmailType    = 'EX'
    Sender             = (New-Object psobject -Property @{ Type = 'EX'; Denied = $denied } | Add-Member -MemberType ScriptMethod -Name GetExchangeUser -Value { throw $this.Denied } -PassThru)
    PropertyAccessor   = (New-Accessor @{ $script:PrInternetMessageId = '<fake-0005@example.test>'; $script:PrSenderSmtpAddress = $denied })
  })

# 6. Not plain mail: meeting request (53), delivery report (46), task (48).
Add-Case 'meeting-request' (New-FakeMail @{ Class = 53 })
Add-Case 'report' (New-FakeMail @{ Class = 46 })
Add-Case 'task' (New-FakeMail @{ Class = 48 })

# 7. No Internet Message-ID: falls back to the EntryID.
Add-Case 'no-message-id' (New-FakeMail @{ PropertyAccessor = (New-Accessor @{}) })

# 8. A body far over the character limit is cut; one whose JSON is large because
#    of escaping (control characters become , six bytes each) is shrunk
#    until the file is below the size cap.
Add-Case 'huge-body' (New-FakeMail @{ Body = ('lorem ipsum dolor sit amet ' * 60000) })
Add-Case 'huge-escaped' (New-FakeMail @{ Body = ([string][char]1) * 200000 }) @{ MaxBodyChars = 200000 }

# 9. ReceivedTime missing (Outlook's year-4501 "no date"): CreationTime is used.
Add-Case 'no-received-time' (New-FakeMail @{ ReceivedTime = [datetime]'4501-01-01T00:00:00' })

# 10. Many recipients are capped.
$crowd = 1..30 | ForEach-Object { New-Recipient ('Person {0}' -f $_) ('person{0}@deloitte.com' -f $_) 1 (New-AddressEntry 'SMTP' $null) $null }
Add-Case 'many-recipients' (New-FakeMail @{ Recipients = $crowd }) @{ MaxRecipients = 10 }

# --- helper functions -------------------------------------------------------

$helpers = [ordered]@{}

# Restrict filters never depend on the current culture.
$since = [datetime]'2026-10-10T09:30:00'
$byCulture = [ordered]@{}
foreach ($culture in @('en-US', 'en-GB', 'en-IN', 'de-DE', 'fr-FR', 'ja-JP')) {
  [System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo($culture)
  $byCulture[$culture] = [ordered]@{
    dasl = Get-DaslReceivedFilter $since
    jet  = Get-JetReceivedFilter $since
    iso  = ConvertTo-IsoOffset ([datetime]'2026-10-22T09:14:00')
    file = Get-IntakeFileName -SourceId '<fake-0001@example.test>' -ReceivedUtc ([datetime]'2026-10-22T03:44:00')
  }
}
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
$helpers['cultures'] = $byCulture
$wrapped = [System.Exception]::new('Exception getting "SenderEmailAddress": outer', [System.Runtime.InteropServices.COMException]::new('inner', -2147467260))
$helpers['guardChain'] = [ordered]@{
  wrapped = [bool](Test-GuardError $wrapped)
  byMessage = [bool](Test-GuardError ([System.Exception]::new('Operation aborted')))
  other = [bool](Test-GuardError ([System.Exception]::new('The RPC server is unavailable')))
  none = [bool](Test-GuardError $null)
}
$helpers['segments'] = [ordered]@{
  a = [string[]]@(ConvertTo-FolderSegments 'Inbox\PMO')
  b = [string[]]@(ConvertTo-FolderSegments ' Inbox / PMO / Clients ')
  c = [string[]]@(ConvertTo-FolderSegments 'Archive')
  d = [string[]]@(ConvertTo-FolderSegments '\\')
}

# Writing a file and the seen-state, in a temp folder.
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('pmo-harness-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work)
try {
  $name = Get-IntakeFileName -SourceId 'x' -ReceivedUtc ([datetime]'2026-01-02T03:04:05')
  $fileJson = '{"a":"caf' + $eAcute + '"}'
  $written = Write-IntakeFile -Directory $work -FileName $name -Json $fileJson
  $bytes = [System.IO.File]::ReadAllBytes($written)
  $helpers['write'] = [ordered]@{
    name       = $name
    leftovers  = [string[]]@(Get-ChildItem -LiteralPath $work | ForEach-Object { $_.Name })
    firstBytes = [int[]]@($bytes[0..2])
    text       = [System.Text.Encoding]::UTF8.GetString($bytes)
  }

  $statePath = Join-Path $work 'sub\seen.json'
  $seen = @{ '<new@example.test>' = (Get-Date).ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture); '<old@example.test>' = '2020-01-01T00:00:00.0000000Z' }
  Save-SeenState -Path $statePath -Seen $seen
  $back = Read-SeenState $statePath
  $helpers['state'] = [ordered]@{
    keys      = [string[]]@($back.Keys | Sort-Object)
    leftovers = [string[]]@(Get-ChildItem -LiteralPath (Split-Path -Parent $statePath) | ForEach-Object { $_.Name })
    missing   = @((Read-SeenState (Join-Path $work 'nope.json')).Keys).Count
  }
  Set-Content -LiteralPath (Join-Path $work 'bad.json') -Value '{ not json' -Encoding ASCII
  $helpers['badState'] = @((Read-SeenState (Join-Path $work 'bad.json') 3>$null).Keys).Count
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}

$doc = [ordered]@{ cases = [object[]]$results.ToArray(); helpers = $helpers }
[System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject $doc -Depth 8), $utf8NoBom)
