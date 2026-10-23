<#
.SYNOPSIS
  Writes valid pmo-intake/1 sample files into an inbox folder, for testing the
  PMO To-Do app without Power Automate.

.DESCRIPTION
  All content is fictional. Files are written as <name>.tmp and then renamed to
  <name>.json (the same hand-off a real producer should use), so the app never
  reads a half-written file. The script only writes into the folder you give it;
  it never reads, deletes or sends anything.

  -InboxDir is mandatory on purpose. Point it at a TEMP folder while testing and
  start the app with the same folder, for example:

    $env:AI_OS_PMO_INBOX_DIR = "$env:TEMP\pmo-inbox"
    $env:AI_OS_PMO_DATA_DIR  = "$env:TEMP\pmo-data"
    pnpm dev
    .\New-SampleIntake.ps1 -InboxDir "$env:TEMP\pmo-inbox" -Kind All

.PARAMETER InboxDir
  Folder to write into. It must already exist (the script does not create it,
  so a typo cannot silently invent a new folder).

.PARAMETER Kind
  Task      An Outlook email that asks for something (Deloitte sender).
  Fyi       An Outlook FYI email, HTML body (should land under "Probably not a task").
  Teams     A Teams "For a selected message" style item (name-only sender, deep link).
  Manual    A manual-paste item.
  Blocked   An Outlook email from a blocked domain (lands under Filtered).
  All       One of each of the above.

.PARAMETER TenantId
  Tenant GUID placed in the Teams sample's context and deep link. Leave the
  default to see the Teams item filtered; pass the GUID you allowlisted to see
  it go through.

.PARAMETER Unique
  Give every file a fresh sourceId so it is not treated as a duplicate of an
  earlier run. Without it the same sourceIds are reused, which is how you test
  de-duplication (run the script twice).

.PARAMETER Copies
  Write each selected sample this many times (used to test de-duplication when
  combined with the default, repeatable sourceIds).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InboxDir,

  [ValidateSet('All', 'Task', 'Fyi', 'Teams', 'Manual', 'Blocked')]
  [string]$Kind = 'All',

  [string]$TenantId = '00000000-0000-0000-0000-000000000000',

  [switch]$Unique,

  [ValidateRange(1, 10)]
  [int]$Copies = 1
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InboxDir -PathType Container)) {
  throw "InboxDir '$InboxDir' does not exist. Create it first (this script never creates the inbox)."
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$now = Get-Date
$stamp = $now.ToString('yyyyMMdd-HHmmss')
$suffix = if ($Unique) { '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) } else { '' }

function ConvertTo-IsoLocal([datetime]$when) {
  $when.ToString("yyyy-MM-dd'T'HH:mm:sszzz")
}

function Write-Sample([string]$Name, [hashtable]$Intake) {
  $json = $Intake | ConvertTo-Json -Depth 8
  for ($i = 1; $i -le $Copies; $i++) {
    $file = '{0}-{1}-{2}' -f $stamp, $Name, $i
    $tmp = Join-Path $InboxDir ($file + '.tmp')
    $final = Join-Path $InboxDir ($file + '.json')
    [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $final
    Write-Host "wrote $final"
  }
}

$samples = [ordered]@{}

$samples['Task'] = @{
  schema     = 'pmo-intake/1'
  producer   = 'manual-paste'
  source     = 'outlook'
  sourceId   = "SAMPLE-TASK-0001$suffix"
  receivedAt = ConvertTo-IsoLocal $now.AddMinutes(-30)
  sender     = @{ name = 'Pat Sample'; address = 'pat.sample@deloitte.com' }
  recipients = @(
    @{ name = 'Alwin Saju'; address = 'alsaju@deloitte.com'; role = 'to' },
    @{ name = 'Jordan Sample'; address = 'jordan.sample@deloitte.com'; role = 'cc' }
  )
  subject    = 'Q4 programme status pack - input needed'
  body       = @{
    text   = "Hi Alwin,`n`nCould you please send me the consolidated RAID log for the Contoso Programme by Tuesday? I need it for the steering committee pre-read.`n`nAlso, please confirm whether the milestone M4 date has moved.`n`nThanks,`nPat`n`n________________________________`nFrom: Jordan Sample <jordan.sample@deloitte.com>`nSent: yesterday`nTo: Pat Sample`nSubject: RE: Q4 programme status pack`n`nPat, the template is on the shared drive."
    format = 'text'
  }
  context    = @{ mailbox = 'alsaju@deloitte.com'; importance = 'high' }
  link       = 'outlook:00000000SAMPLEENTRYID0001'
}

$samples['Fyi'] = @{
  schema     = 'pmo-intake/1'
  producer   = 'manual-paste'
  source     = 'outlook'
  sourceId   = "SAMPLE-FYI-0002$suffix"
  receivedAt = ConvertTo-IsoLocal $now.AddMinutes(-20)
  sender     = @{ name = 'Jordan Sample'; address = 'jordan.sample@deloitte.com' }
  recipients = @(@{ name = 'Alwin Saju'; address = 'alsaju@deloitte.com'; role = 'to' })
  subject    = 'FYI: steering committee moved to Thursday'
  body       = @{
    text   = '<html><body><p>Hi all,</p><p>FYI the steering committee has moved to Thursday, same time. No action needed from you - the invite has already been updated.</p><p>Thanks,<br>Jordan</p></body></html>'
    format = 'html'
  }
  context    = @{ mailbox = 'alsaju@deloitte.com'; importance = 'normal' }
  link       = 'outlook:00000000SAMPLEENTRYID0002'
}

$teamsMessageId = [string][DateTimeOffset]::new($now.AddMinutes(-10)).ToUnixTimeMilliseconds()
$samples['Teams'] = @{
  schema     = 'pmo-intake/1'
  producer   = 'manual-paste'
  source     = 'teams'
  sourceId   = "SAMPLE-TEAMS-$teamsMessageId$suffix"
  receivedAt = ConvertTo-IsoLocal $now.AddMinutes(-10)
  sender     = @{ name = 'Jordan Sample' }
  recipients = @()
  subject    = 'PMO weekly sync'
  body       = @{
    text   = '<p>@Alwin can you update the resourcing tracker with the two new joiners before our call tomorrow? Ping me once it is done.</p>'
    format = 'html'
  }
  context    = @{ tenantId = $TenantId; chatType = 'groupChat' }
  link       = "https://teams.microsoft.com/l/message/19:sample0000000000000000000000000000@thread.v2/$teamsMessageId`?tenantId=$TenantId"
}

$samples['Manual'] = @{
  schema     = 'pmo-intake/1'
  producer   = 'manual-paste'
  source     = 'manual'
  sourceId   = "SAMPLE-MANUAL-0004$suffix"
  receivedAt = ConvertTo-IsoLocal $now.AddMinutes(-5)
  sender     = @{ name = 'Pat Sample' }
  subject    = 'Hallway ask'
  body       = @{ text = 'Pat asked me to chase the vendor for the revised SOW before Friday.'; format = 'text' }
}

$samples['Blocked'] = @{
  schema     = 'pmo-intake/1'
  producer   = 'manual-paste'
  source     = 'outlook'
  sourceId   = "SAMPLE-BLOCKED-0005$suffix"
  receivedAt = ConvertTo-IsoLocal $now.AddMinutes(-3)
  sender     = @{ name = 'Casey Sample'; address = 'casey.sample@takeda.com' }
  recipients = @(@{ name = 'Alwin Saju'; address = 'alsaju@deloitte.com'; role = 'to' })
  subject    = 'Example of a message the filter quarantines'
  body       = @{ text = 'This sender is on a blocked domain, so the item lands under Filtered and its text is dropped.'; format = 'text' }
  link       = 'outlook:00000000SAMPLEENTRYID0005'
}

$selected = if ($Kind -eq 'All') { $samples.Keys } else { @($Kind) }
foreach ($name in $selected) {
  Write-Sample -Name $name.ToLower() -Intake $samples[$name]
}
