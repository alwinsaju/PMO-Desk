<#
.SYNOPSIS
  Outlook mail item -> pmo-intake/1 mapping and the small file/state helpers
  used by Export-OutlookToInbox.ps1. Dot-source this file; it does nothing on
  its own.

.DESCRIPTION
  Everything here works on plain objects: an "item" is anything that has the
  same property names as an Outlook MailItem (Class, Subject, Body, HTMLBody,
  SenderName, SenderEmailAddress, SenderEmailType, Sender, Recipients,
  Attachments, ReceivedTime, EntryID, ConversationID, Importance,
  PropertyAccessor). That is what lets the mapping be unit-tested with fake
  PSCustomObjects and no Outlook installed (see
  src/lib/pmo/outlookExport.test.mjs and tests/OutlookMapping.harness.ps1).

  READ ONLY. Nothing in this file writes to, or calls a method that changes, a
  mail item. Property reads are wrapped so that one failing property (for
  example because Outlook's programmatic-access prompt was denied) degrades
  that field instead of stopping the run.

  ASCII only on purpose: Windows PowerShell 5.1 reads a script that has no BOM
  as ANSI, so a stray typographic dash would corrupt it.
#>

$script:PrInternetMessageId = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'
$script:PrSmtpAddress = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001E'
$script:PrSenderSmtpAddress = 'http://schemas.microsoft.com/mapi/proptag/0x5D01001F'
$script:PrAttachMimeTag = 'http://schemas.microsoft.com/mapi/proptag/0x370E001E'
$script:PrAttachmentHidden = 'http://schemas.microsoft.com/mapi/proptag/0x7FFE000B'
$script:OlMailClass = 43
$script:Invariant = [System.Globalization.CultureInfo]::InvariantCulture

# --- guarded reads ---------------------------------------------------------

function New-MapContext {
  @{ Warnings = (New-Object System.Collections.ArrayList); Guard = $false }
}

# E_ABORT (0x80004004) is what Outlook raises when the user answers "Deny" to
# the object-model guard prompt ("A program is trying to access email address
# information stored in Outlook"). PowerShell wraps a failing COM property read
# in another exception, so the whole InnerException chain is checked.
function Test-GuardError($Exception) {
  $e = $Exception
  while ($null -ne $e) {
    if ($e.HResult -eq -2147467260) { return $true }
    if ($e.Message -match 'Operation aborted|operation was aborted|programmatic access') { return $true }
    $e = $e.InnerException
  }
  return $false
}

# Runs a read. A failure becomes a warning and $null (a denied guard prompt is
# also remembered in $Ctx.Guard). -Quiet is for reads that are expected to fail
# when a property simply is not there; a denied prompt is still recorded.
function Read-Safe {
  param($Ctx, [string]$What, [scriptblock]$Read, [switch]$Quiet)
  try {
    return (& $Read)
  } catch {
    if (Test-GuardError $_.Exception) {
      $Ctx.Guard = $true
      [void]$Ctx.Warnings.Add(('{0}: blocked by the Outlook programmatic-access prompt' -f $What))
    } elseif (-not $Quiet) {
      [void]$Ctx.Warnings.Add(('{0}: {1}' -f $What, $_.Exception.Message))
    }
    return $null
  }
}

# --- small pure helpers ----------------------------------------------------

function ConvertTo-IsoOffset($When) {
  if ($null -eq $When) { return $null }
  try { $dt = [datetime]$When } catch { return $null }
  # Outlook's "no date" is the year 4501.
  if ($dt.Year -lt 1990 -or $dt.Year -gt 3000) { return $null }
  # A DateTime of Unspecified kind (what COM hands back) is treated as local.
  $dto = New-Object System.DateTimeOffset($dt)
  return $dto.ToString("yyyy-MM-dd'T'HH:mm:sszzz", $script:Invariant)
}

function Test-LooksSmtp($Value) {
  if ($null -eq $Value) { return $false }
  $s = ([string]$Value).Trim()
  # An Exchange (X500) address starts with "/o=" and is not mail-routable.
  return [bool]($s -match '^[^/\s@<>]+@[^@\s<>]+\.[^@\s<>]+$')
}

# The SMTP address of a sender or recipient. Exchange users come back from
# Outlook as X500 distinguished names ("/O=EXCHANGELABS/.../CN=RECIPIENTS/..."),
# which the PMO filter cannot read, so those are resolved through the fallbacks
# (GetExchangeUser().PrimarySmtpAddress, then the MAPI SMTP properties). If
# nothing resolves the address is $null and the filter will say so.
function Resolve-SmtpAddress {
  param($Ctx, [string]$What, $Raw, $Type, [scriptblock[]]$Fallbacks)
  # Already a routable address (the Type is "SMTP", or it plainly is one).
  if (Test-LooksSmtp $Raw) { return ([string]$Raw).Trim() }
  foreach ($fallback in $Fallbacks) {
    $value = Read-Safe -Ctx $Ctx -What $What -Read $fallback -Quiet
    if (Test-LooksSmtp $value) { return ([string]$value).Trim() }
  }
  return $null
}

function ConvertFrom-HtmlToText([string]$Html) {
  if ([string]::IsNullOrWhiteSpace($Html)) { return '' }
  $t = $Html
  $t = [regex]::Replace($t, '(?s)<!--.*?-->', '')
  $t = [regex]::Replace($t, '(?is)<(script|style|head)\b.*?</\1\s*>', '')
  $t = [regex]::Replace($t, '(?i)<br\s*/?>', "`n")
  $t = [regex]::Replace($t, '(?i)</(p|div|tr|li|h[1-6]|table|blockquote)\s*>', "`n")
  $t = [regex]::Replace($t, '(?i)</t[dh]\s*>', ' ')
  $t = [regex]::Replace($t, '(?s)<[^>]+>', '')
  $t = [System.Net.WebUtility]::HtmlDecode($t)
  return (Format-BodyText $t)
}

function Format-BodyText([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $t = [regex]::Replace($Text, '\r\n?', "`n")
  $t = [regex]::Replace($t, '[ \t\xA0]+\n', "`n")
  $t = [regex]::Replace($t, '\n{3,}', "`n`n")
  return $t.Trim()
}

function Get-ImportanceName($Value) {
  switch ([int]$Value) { 0 { return 'low' } 2 { return 'high' } default { return 'normal' } }
}

$script:MimeByExtension = @{
  '.pdf' = 'application/pdf'; '.doc' = 'application/msword'
  '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  '.xls' = 'application/vnd.ms-excel'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  '.ppt' = 'application/vnd.ms-powerpoint'
  '.pptx' = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'
  '.txt' = 'text/plain'; '.csv' = 'text/csv'; '.zip' = 'application/zip'
  '.msg' = 'application/vnd.ms-outlook'; '.ics' = 'text/calendar'
}

# --- the mapping -----------------------------------------------------------

<#
.SYNOPSIS
  Map one Outlook item to a pmo-intake/1 document.

.OUTPUTS
  PSCustomObject: Skipped, SkipReason, SourceId, ReceivedUtc, Intake (ordered
  dictionary, ready for ConvertTo-IntakeFileText), Warnings, GuardDenied.
  Items that are not plain mail (meeting requests, delivery reports, tasks)
  come back Skipped; nothing is exported for them.
#>
function ConvertTo-PmoIntake {
  param(
    $Item,
    [string]$Mailbox = '',
    [int]$MaxBodyChars = 150000,
    [int]$MaxRecipients = 200
  )
  $ctx = New-MapContext
  $skip = {
    param([string]$Reason)
    [pscustomobject]@{
      Skipped = $true; SkipReason = $Reason; SourceId = $null; ReceivedUtc = $null
      Intake = $null; Warnings = @($ctx.Warnings.ToArray()); GuardDenied = [bool]$ctx.Guard
    }
  }

  $class = Read-Safe -Ctx $ctx -What 'Class' -Read { [int]$Item.Class }
  if ($class -ne $script:OlMailClass) {
    return (& $skip ('Not a mail item (Outlook class {0}: meeting request, report, task or other).' -f $class))
  }

  # Identity: the Internet Message-ID is stable across folders and devices;
  # the EntryID changes when a message is moved, so it is only the fallback.
  $messageId = Read-Safe -Ctx $ctx -What 'InternetMessageId' -Quiet -Read { [string]$Item.PropertyAccessor.GetProperty($script:PrInternetMessageId) }
  $entryId = Read-Safe -Ctx $ctx -What 'EntryID' -Read { [string]$Item.EntryID }
  $sourceId = if (-not [string]::IsNullOrWhiteSpace($messageId)) { $messageId.Trim() } else { $entryId }
  if ([string]::IsNullOrWhiteSpace($sourceId)) {
    return (& $skip 'The message has neither an Internet Message-ID nor an EntryID.')
  }

  $received = Read-Safe -Ctx $ctx -What 'ReceivedTime' -Read { $Item.ReceivedTime }
  $receivedIso = ConvertTo-IsoOffset $received
  if (-not $receivedIso) {
    $received = Read-Safe -Ctx $ctx -What 'CreationTime' -Read { $Item.CreationTime }
    $receivedIso = ConvertTo-IsoOffset $received
    if ($receivedIso) { [void]$ctx.Warnings.Add('ReceivedTime missing; used CreationTime.') }
  }
  if (-not $receivedIso) {
    return (& $skip 'The message has no received or creation time.')
  }
  $receivedUtc = ([datetime]$received).ToUniversalTime()

  $subject = Read-Safe -Ctx $ctx -What 'Subject' -Read { [string]$Item.Subject }
  $senderName = Read-Safe -Ctx $ctx -What 'SenderName' -Read { [string]$Item.SenderName }
  $senderRaw = Read-Safe -Ctx $ctx -What 'SenderEmailAddress' -Read { [string]$Item.SenderEmailAddress }
  $senderType = Read-Safe -Ctx $ctx -What 'SenderEmailType' -Read { [string]$Item.SenderEmailType }
  $senderAddress = Resolve-SmtpAddress -Ctx $ctx -What 'Sender address' -Raw $senderRaw -Type $senderType -Fallbacks @(
    { $Item.Sender.GetExchangeUser().PrimarySmtpAddress },
    { $Item.PropertyAccessor.GetProperty($script:PrSenderSmtpAddress) },
    { $Item.Sender.PropertyAccessor.GetProperty($script:PrSmtpAddress) }
  )
  if (-not $senderAddress) {
    [void]$ctx.Warnings.Add('Sender address could not be resolved to SMTP; the PMO filter will quarantine this message.')
  }

  $recipients = New-Object System.Collections.ArrayList
  $recipientItems = Read-Safe -Ctx $ctx -What 'Recipients' -Read { @($Item.Recipients) }
  $seenRecipients = 0
  foreach ($r in @($recipientItems)) {
    if ($null -eq $r) { continue }
    $role = switch ([int](Read-Safe -Ctx $ctx -What 'Recipient type' -Read { $r.Type })) { 1 { 'to' } 2 { 'cc' } default { $null } }
    if (-not $role) { continue }
    $seenRecipients++
    if ($seenRecipients -gt $MaxRecipients) {
      [void]$ctx.Warnings.Add(('More than {0} recipients; the rest were left out.' -f $MaxRecipients))
      break
    }
    $rName = Read-Safe -Ctx $ctx -What 'Recipient name' -Read { [string]$r.Name }
    $rRaw = Read-Safe -Ctx $ctx -What 'Recipient address' -Read { [string]$r.Address }
    $rType = Read-Safe -Ctx $ctx -What 'Recipient address type' -Read { [string]$r.AddressEntry.Type }
    $rAddress = Resolve-SmtpAddress -Ctx $ctx -What 'Recipient address' -Raw $rRaw -Type $rType -Fallbacks @(
      { $r.PropertyAccessor.GetProperty($script:PrSmtpAddress) },
      { $r.AddressEntry.GetExchangeUser().PrimarySmtpAddress }
    )
    $entry = [ordered]@{}
    if ($rName) { $entry['name'] = $rName }
    if ($rAddress) { $entry['address'] = $rAddress }
    $entry['role'] = $role
    [void]$recipients.Add($entry)
  }

  # Body: the plain-text rendition; if Outlook has none, the HTML turned into text.
  $plain = Read-Safe -Ctx $ctx -What 'Body' -Read { [string]$Item.Body }
  $bodyText = Format-BodyText $plain
  if ([string]::IsNullOrWhiteSpace($bodyText)) {
    $html = Read-Safe -Ctx $ctx -What 'HTMLBody' -Read { [string]$Item.HTMLBody }
    $bodyText = ConvertFrom-HtmlToText $html
  }
  if ($bodyText.Length -gt $MaxBodyChars) {
    $bodyText = $bodyText.Substring(0, $MaxBodyChars) + "`n[... truncated by the Outlook exporter ...]"
    [void]$ctx.Warnings.Add(('Body longer than {0} characters; truncated.' -f $MaxBodyChars))
  }

  # Attachments: metadata only. Nothing is opened, read or saved.
  $attachments = New-Object System.Collections.ArrayList
  $attachmentItems = Read-Safe -Ctx $ctx -What 'Attachments' -Read { @($Item.Attachments) }
  foreach ($a in @($attachmentItems)) {
    if ($null -eq $a) { continue }
    if ($attachments.Count -ge 50) { break }
    $hidden = Read-Safe -Ctx $ctx -What 'Attachment hidden flag' -Quiet -Read { $a.PropertyAccessor.GetProperty($script:PrAttachmentHidden) }
    if ($hidden -eq $true) { continue } # inline images and signature logos
    $aName = Read-Safe -Ctx $ctx -What 'Attachment name' -Read { [string]$a.FileName }
    if (-not $aName) { $aName = Read-Safe -Ctx $ctx -What 'Attachment name' -Read { [string]$a.DisplayName } }
    $aSize = Read-Safe -Ctx $ctx -What 'Attachment size' -Read { [double]$a.Size }
    $aType = Read-Safe -Ctx $ctx -What 'Attachment type' -Quiet -Read { [string]$a.PropertyAccessor.GetProperty($script:PrAttachMimeTag) }
    if ([string]::IsNullOrWhiteSpace($aType) -and $aName) {
      $ext = [System.IO.Path]::GetExtension($aName).ToLowerInvariant()
      if ($script:MimeByExtension.ContainsKey($ext)) { $aType = $script:MimeByExtension[$ext] }
    }
    $att = [ordered]@{}
    if ($aName) { $att['name'] = $aName }
    if ($aType) { $att['contentType'] = $aType }
    if ($null -ne $aSize) { $att['size'] = $aSize }
    [void]$attachments.Add($att)
  }

  $conversationId = Read-Safe -Ctx $ctx -What 'ConversationID' -Read { [string]$Item.ConversationID }
  $importance = Get-ImportanceName (Read-Safe -Ctx $ctx -What 'Importance' -Read { [int]$Item.Importance })

  $sender = [ordered]@{}
  if ($senderName) { $sender['name'] = $senderName }
  if ($senderAddress) { $sender['address'] = $senderAddress }

  $context = [ordered]@{}
  if ($Mailbox) { $context['mailbox'] = $Mailbox }
  $context['importance'] = $importance

  $intake = [ordered]@{
    schema      = 'pmo-intake/1'
    producer    = 'outlook-com'
    source      = 'outlook'
    sourceId    = $sourceId
    receivedAt  = $receivedIso
    sender      = $sender
    recipients  = [object[]]$recipients.ToArray()
    subject     = [string]$subject
    body        = [ordered]@{ text = $bodyText; format = 'text' }
    context     = $context
    attachments = [object[]]$attachments.ToArray()
  }
  if ($conversationId) { $intake['thread'] = [ordered]@{ conversationId = $conversationId } }
  if ($entryId) { $intake['link'] = 'outlook:' + $entryId }

  [pscustomobject]@{
    Skipped = $false; SkipReason = $null; SourceId = $sourceId; ReceivedUtc = $receivedUtc
    Intake = $intake; Warnings = @($ctx.Warnings.ToArray()); GuardDenied = [bool]$ctx.Guard
  }
}

# --- serialising and writing ------------------------------------------------

# pmo-intake files over 1 MB are skipped by the app for good, so the body is
# shortened until the file fits comfortably under that.
function ConvertTo-IntakeFileText {
  param([System.Collections.IDictionary]$Intake, [int]$MaxBytes = 900000)
  $enc = New-Object System.Text.UTF8Encoding($false)
  for ($i = 0; $i -lt 12; $i++) {
    $json = ConvertTo-Json -InputObject $Intake -Depth 8
    if ($enc.GetByteCount($json) -le $MaxBytes) { return $json }
    $text = [string]$Intake['body']['text']
    $Intake['body']['text'] = $text.Substring(0, [int]($text.Length * 0.7)) + "`n[... truncated by the Outlook exporter ...]"
  }
  throw 'Could not shrink the message below the file size limit.'
}

# outlook-<yyyymmddThhmmssZ>-<8 hex>.json; the hex is the start of
# sha256(sourceId), so a message always gets the same name.
function Get-IntakeFileName {
  param([string]$SourceId, [datetime]$ReceivedUtc, [string]$Source = 'outlook')
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($SourceId))
  } finally {
    $sha.Dispose()
  }
  $hex = (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 8)
  return ('{0}-{1}-{2}.json' -f $Source, $ReceivedUtc.ToString("yyyyMMdd'T'HHmmss'Z'", $script:Invariant), $hex)
}

# <name>.tmp first, then rename, so the app (which only reads *.json) never
# sees a half-written file. UTF-8 without a BOM. The temp file is created in the
# inbox itself so the rename stays on one volume.
function Write-IntakeFile {
  param([string]$Directory, [string]$FileName, [string]$Json)
  $final = Join-Path $Directory $FileName
  $tmp = Join-Path $Directory ([System.IO.Path]::GetFileNameWithoutExtension($FileName) + '.tmp')
  [System.IO.File]::WriteAllText($tmp, $Json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $final -Force
  return $final
}

# --- finding the mail -------------------------------------------------------

# Restrict filters need a date string in a form Outlook parses whatever the
# Windows regional settings are. Two forms are produced, both formatted with the
# invariant culture (never the machine's): the DASL one, with an ISO date, which
# does not depend on the locale, and the Jet one in the US form
# 'MM/dd/yyyy hh:mm tt', used as a second attempt. The window is widened by a
# day because the two forms disagree about local time versus UTC; the caller
# re-checks every item's real time, so the margin only costs a few extra reads.
function Get-DaslReceivedFilter([datetime]$Since) {
  $stamp = $Since.AddDays(-1).ToString('yyyy-MM-dd HH:mm', $script:Invariant)
  return ('@SQL="urn:schemas:httpmail:datereceived" >= ''{0}''' -f $stamp)
}

function Get-JetReceivedFilter([datetime]$Since) {
  $stamp = $Since.AddDays(-1).ToString('MM/dd/yyyy hh:mm tt', $script:Invariant)
  return ("[ReceivedTime] >= '{0}'" -f $stamp)
}

# 'Inbox\PMO', 'Inbox/PMO/Clients' -> 'Inbox','PMO','Clients' (one string per
# output; wrap the call in @() to get an array even for a single segment).
function ConvertTo-FolderSegments([string]$Path) {
  foreach ($part in ($Path -split '[\\/]')) {
    $trimmed = $part.Trim()
    if ($trimmed -ne '') { $trimmed }
  }
}

# --- the "already exported" state ------------------------------------------

# { "version": 1, "seen": { "<sourceId>": "<ISO time exported>" } }. Keyed by
# the same sourceId that goes into the file (Message-ID, else EntryID).
function Read-SeenState([string]$Path) {
  $seen = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $seen }
  try {
    $doc = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $doc -and $null -ne $doc.seen) {
      foreach ($p in $doc.seen.PSObject.Properties) {
        $seen[[string]$p.Name] = if ($p.Value -is [datetime]) { $p.Value.ToUniversalTime().ToString('o', $script:Invariant) } else { [string]$p.Value }
      }
    }
  } catch {
    Write-Warning ('The seen-file {0} could not be read ({1}); starting empty. The app removes duplicates anyway.' -f $Path, $_.Exception.Message)
    return @{}
  }
  return $seen
}

function Save-SeenState {
  param([string]$Path, [hashtable]$Seen, [datetime]$Now = (Get-Date).ToUniversalTime(), [int]$KeepDays = 365)
  $keep = [ordered]@{}
  $cutoff = $Now.AddDays(-$KeepDays)
  foreach ($key in ($Seen.Keys | Sort-Object)) {
    $when = [datetime]::MinValue
    $parsed = [datetime]::TryParse([string]$Seen[$key], $script:Invariant, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$when)
    if (-not $parsed -or $when.ToUniversalTime() -ge $cutoff) { $keep[$key] = $Seen[$key] }
  }
  $doc = [ordered]@{ version = 1; updatedAt = $Now.ToString('o', $script:Invariant); seen = $keep }
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
  $tmp = $Path + '.tmp'
  [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $doc -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
