<#
.SYNOPSIS
  READ-ONLY export of Outlook mail into the PMO inbox, one pmo-intake/1 JSON
  file per message, for the PMO To-Do app to pick up.

.DESCRIPTION
  Talks to CLASSIC Outlook through COM. "New Outlook" (the toggle in the
  top-right corner of Outlook) does not support COM; the script detects that and
  says so.

  Which mail:
    - With -FolderPath (for example 'Inbox\PMO'): the mail received in the last
      -SinceDays days in that folder.
    - Without it: every FLAGGED mail anywhere in your default mailbox (Outlook's
      To-Do / "For Follow Up" search folder, FlagStatus = marked), modified in
      the last -SinceDays days. Flagging a mail updates it, so a mail you flag
      today is found even if it arrived a month ago.

  What it never does: it does not send, delete, move, copy, save, display or
  change any mail (no category, flag, read-state or other property is set), it
  never opens, reads or saves an attachment (name, size and type only), and it
  never writes anywhere except the inbox folder and its own state/log files.
  Mail that is not a plain mail item (meeting requests, delivery reports,
  tasks) is skipped.

  Each exported message is written as <name>.tmp and renamed to
  outlook-<yyyymmddThhmmssZ>-<8 hex>.json (UTF-8, no BOM). A "seen" file keyed
  by the Internet Message-ID (EntryID if there is none) stops the same message
  being exported twice; the app also de-duplicates on the same id, so a repeat
  is harmless.

  Start with -DryRun: it reads Outlook and prints what it WOULD write, and
  writes nothing (no file, no state).

.PARAMETER InboxDir
  The PMO drop folder. Must already exist (it is never created). Default: the
  OneDrive PMO-Inbox.

.PARAMETER FolderPath
  Outlook folder to read, e.g. 'Inbox\PMO' or 'Inbox'. A first segment of
  'Inbox' is your default Inbox; any other first segment is looked up at the top
  of your default mailbox. Omit it to export flagged mail instead.

.PARAMETER SinceDays
  How far back to look. Default 14. Use a larger value once to backfill.

.PARAMETER StatePath
  The script's own seen-file. Default %LOCALAPPDATA%\AI OS\pmo-intake\outlook-seen.json.

.PARAMETER MaxItems
  Most messages exported in one run (newest first). Default 200.

.PARAMETER DryRun
  Print what would be written; write nothing. -WhatIf does the same.

.PARAMETER IgnoreSeen
  Export messages even if the seen-file says they were exported before. Use it
  after you allow a sender domain in the app's Settings, to send the messages
  that were filtered. Messages the app already has are dropped as duplicates.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Export-OutlookToInbox.ps1 -DryRun

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Export-OutlookToInbox.ps1 -FolderPath 'Inbox\PMO' -SinceDays 30

.NOTES
  Exit codes: 0 ok, 2 Outlook COM unavailable (new Outlook or not installed),
  3 Outlook folder not found, 4 stopped after Outlook's programmatic-access
  prompt was denied, 5 inbox folder missing, 6 Outlook stopped answering.
  ASCII only: Windows PowerShell 5.1 reads a script without a BOM as ANSI.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InboxDir = 'C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox',
  [string]$FolderPath,
  [ValidateRange(1, 3650)][int]$SinceDays = 14,
  [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'AI OS\pmo-intake\outlook-seen.json'),
  [ValidateRange(1, 5000)][int]$MaxItems = 200,
  [switch]$DryRun,
  [switch]$IgnoreSeen
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'OutlookMapping.ps1')

$dry = $DryRun.IsPresent -or [bool]$WhatIfPreference
$olFolderInbox = 6
$olFolderToDo = 28
$olFlagMarked = 2
$logPath = Join-Path (Split-Path -Parent $StatePath) 'outlook-export.log'

function Write-RunLog([string]$Line) {
  if ($dry) { return }
  try {
    $dir = Split-Path -Parent $logPath
    if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    Add-Content -LiteralPath $logPath -Value ('{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Line) -Encoding UTF8
  } catch {
    # A log that cannot be written must not stop the export.
  }
}

function Stop-Run([int]$Code, [string]$Message) {
  Write-Host $Message -ForegroundColor Red
  Write-RunLog ('stopped (exit {0}): {1}' -f $Code, $Message)
  exit $Code
}

function Release-Com($Object) {
  if ($null -ne $Object -and [System.Runtime.InteropServices.Marshal]::IsComObject($Object)) {
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($Object) } catch {}
  }
}

# --- checks that need no Outlook ---------------------------------------------

if (-not (Test-Path -LiteralPath $InboxDir -PathType Container)) {
  if ($dry) {
    Write-Warning "Inbox folder '$InboxDir' does not exist (a real run would stop here)."
  } else {
    Stop-Run 5 "Inbox folder '$InboxDir' does not exist. Create it first (in OneDrive: a folder named PMO-Inbox); this script never creates it."
  }
}

# --- Outlook -----------------------------------------------------------------

$classicRunning = @(Get-Process -Name 'OUTLOOK' -ErrorAction SilentlyContinue).Count -gt 0
$newRunning = @(Get-Process -Name 'olk' -ErrorAction SilentlyContinue).Count -gt 0
if ($newRunning -and -not $classicRunning) {
  Stop-Run 2 ("'New Outlook' is running, and it does not support COM, so this script cannot read it.`n" +
    "Switch back to classic Outlook (turn off the 'New Outlook' toggle at the top right of Outlook), start classic Outlook, then run this again.")
}

$outlook = $null
try {
  $outlook = New-Object -ComObject 'Outlook.Application'
} catch {
  Stop-Run 2 ("Could not start Outlook through COM ($($_.Exception.Message)).`n" +
    "This needs CLASSIC desktop Outlook. 'New Outlook' does not support COM: turn off its toggle (top right) and try again.")
}
if (-not $classicRunning) {
  Write-Host 'Note: classic Outlook was not running; it was started in the background for this run.' -ForegroundColor Yellow
}

$namespace = $null
$folder = $null
$items = $null
$exported = 0
$wouldWrite = 0
$alreadySeen = 0
$skippedNonMail = 0
$skippedNotFlagged = 0
$errorsCount = 0
$guardDenials = 0
$consecutiveErrors = 0
$exitCode = 0

try {
  $namespace = $outlook.GetNamespace('MAPI')

  # Which mailbox, for context.mailbox (best effort; null is fine).
  $mailbox = ''
  try {
    $me = $namespace.CurrentUser
    $mailbox = [string]$me.AddressEntry.GetExchangeUser().PrimarySmtpAddress
    if (-not $mailbox) { $mailbox = [string]$me.Address }
    if ($mailbox -match '^/') { $mailbox = '' }
  } catch {
    $mailbox = ''
  }

  $flaggedMode = [string]::IsNullOrWhiteSpace($FolderPath)
  if ($flaggedMode) {
    try {
      $folder = $namespace.GetDefaultFolder($olFolderToDo)
    } catch {
      Stop-Run 3 "Could not open Outlook's To-Do (flagged mail) folder: $($_.Exception.Message)`nUse -FolderPath 'Inbox\PMO' to name a folder instead."
    }
    $sourceLabel = 'flagged mail (To-Do folder)'
  } else {
    $segments = @(ConvertTo-FolderSegments $FolderPath)
    if ($segments.Count -eq 0) { Stop-Run 3 "-FolderPath '$FolderPath' has no folder name in it." }
    $inbox = $namespace.GetDefaultFolder($olFolderInbox)
    if ($segments[0] -ieq 'Inbox') {
      $folder = $inbox
      $rest = @($segments | Select-Object -Skip 1)
    } else {
      $folder = $inbox.Parent # the top of the default mailbox
      $rest = $segments
    }
    foreach ($segment in $rest) {
      $next = $null
      try { $next = $folder.Folders.Item($segment) } catch { $next = $null }
      if ($null -eq $next) {
        $names = @()
        try { $names = @($folder.Folders | ForEach-Object { $_.Name }) } catch {}
        Stop-Run 3 ("Outlook folder '$segment' was not found under '$($folder.Name)'.`n" +
          'Folders there: ' + ($(if ($names.Count) { $names -join ', ' } else { '(none readable)' })) + "`n" +
          "Check -FolderPath (for example 'Inbox\PMO').")
      }
      $folder = $next
    }
    $sourceLabel = "folder '$FolderPath'"
  }

  $now = Get-Date
  $cutoff = $now.AddDays(-$SinceDays)
  Write-Host ('Reading {0}, since {1} ({2} days){3}' -f $sourceLabel, $cutoff.ToString('yyyy-MM-dd HH:mm', [System.Globalization.CultureInfo]::InvariantCulture), $SinceDays, $(if ($dry) { ' [DRY RUN: nothing will be written]' } else { '' }))

  # Newest first, so the loop can stop at the first item older than the window.
  $items = $folder.Items
  $filterUsed = 'none (checked in code)'
  if (-not $flaggedMode) {
    $restricted = $null
    foreach ($candidate in @(@{ Name = 'DASL'; Text = (Get-DaslReceivedFilter $cutoff) }, @{ Name = 'Jet'; Text = (Get-JetReceivedFilter $cutoff) })) {
      try {
        $restricted = $items.Restrict($candidate.Text)
        $filterUsed = $candidate.Name
        break
      } catch {
        $restricted = $null
      }
    }
    if ($null -ne $restricted) { $items = $restricted }
  }
  $sortField = if ($flaggedMode) { '[LastModificationTime]' } else { '[ReceivedTime]' }
  $canStopEarly = $true
  try { $items.Sort($sortField, $true) } catch { $canStopEarly = $false }
  Write-Host ('Date filter: {0}; newest-first sort: {1}' -f $filterUsed, $(if ($canStopEarly) { 'yes' } else { 'no (scanning everything)' }))

  $seenAll = Read-SeenState $StatePath
  $seen = if ($IgnoreSeen) { @{} } else { $seenAll }
  $stateDirty = $false

  $item = $items.GetFirst()
  while ($null -ne $item) {
    $current = $item
    $item = $null
    try {
      $class = [int]$current.Class
      if ($class -ne 43) {
        $skippedNonMail++
      } elseif ($flaggedMode -and ([int]$current.FlagStatus -ne $olFlagMarked)) {
        $skippedNotFlagged++
      } else {
        $when = if ($flaggedMode) { [datetime]$current.LastModificationTime } else { [datetime]$current.ReceivedTime }
        if ($when -lt $cutoff) {
          if ($canStopEarly) { Release-Com $current; $current = $null; break }
        } else {
          $mapped = ConvertTo-PmoIntake -Item $current -Mailbox $mailbox
          if ($mapped.GuardDenied) {
            $guardDenials++
            if ($guardDenials -ge 3) {
              $exitCode = 4
              Write-Host ("Outlook's programmatic-access prompt was denied 3 times; stopping.`n" +
                "When Outlook asks 'A program is trying to access email address information', tick 'Allow access for 10 minutes' and click Allow, then run again.") -ForegroundColor Red
              break
            }
          }
          foreach ($w in $mapped.Warnings) { Write-Host ('  warning: {0}' -f $w) -ForegroundColor Yellow }

          if ($mapped.Skipped) {
            $skippedNonMail++
            Write-Host ('  skip: {0}' -f $mapped.SkipReason)
          } elseif ((-not $IgnoreSeen) -and $seen.ContainsKey($mapped.SourceId)) {
            $alreadySeen++
          } else {
            $fileName = Get-IntakeFileName -SourceId $mapped.SourceId -ReceivedUtc $mapped.ReceivedUtc
            $subjectText = [string]$mapped.Intake['subject']
            if ($subjectText.Length -gt 60) { $subjectText = $subjectText.Substring(0, 57) + '...' }
            $fromText = [string]$mapped.Intake['sender']['address']
            if (-not $fromText) { $fromText = [string]$mapped.Intake['sender']['name'] }
            if ($dry) {
              $wouldWrite++
              Write-Host ('  WOULD WRITE {0}  {1}  {2}  "{3}"' -f $fileName, $mapped.Intake['receivedAt'], $fromText, $subjectText)
            } else {
              $json = ConvertTo-IntakeFileText -Intake $mapped.Intake
              [void](Write-IntakeFile -Directory $InboxDir -FileName $fileName -Json $json)
              $seenAll[$mapped.SourceId] = (Get-Date).ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
              $seen[$mapped.SourceId] = $seenAll[$mapped.SourceId]
              $stateDirty = $true
              $exported++
              Write-Host ('  wrote {0}  {1}  "{2}"' -f $fileName, $fromText, $subjectText)
              if (($exported % 20) -eq 0) { Save-SeenState -Path $StatePath -Seen $seenAll; $stateDirty = $false }
            }
            $consecutiveErrors = 0
            if (($exported + $wouldWrite) -ge $MaxItems) {
              Write-Host ('Reached -MaxItems ({0}); run again for the rest.' -f $MaxItems)
              break
            }
          }
        }
      }
      $consecutiveErrors = 0
    } catch {
      $errorsCount++
      $consecutiveErrors++
      Write-Host ('  error on one item (skipped): {0}' -f $_.Exception.Message) -ForegroundColor Red
      if ($consecutiveErrors -ge 5) {
        $exitCode = 6
        Write-Host 'Five items in a row failed; Outlook may have closed or stopped answering. Stopping.' -ForegroundColor Red
        break
      }
    } finally {
      Release-Com $current
    }
    try { $item = $items.GetNext() } catch { $item = $null }
  }

  if ($stateDirty -and -not $dry) { Save-SeenState -Path $StatePath -Seen $seenAll }
} finally {
  Release-Com $items
  Release-Com $folder
  Release-Com $namespace
  Release-Com $outlook
  [System.GC]::Collect()
}

$summary = if ($dry) {
  'DRY RUN: would write {0}, already exported {1}, skipped non-mail {2}, not flagged {3}, errors {4}. Nothing was written.' -f $wouldWrite, $alreadySeen, $skippedNonMail, $skippedNotFlagged, $errorsCount
} else {
  'Wrote {0} file(s) to {1}. Already exported {2}, skipped non-mail {3}, not flagged {4}, errors {5}.' -f $exported, $InboxDir, $alreadySeen, $skippedNonMail, $skippedNotFlagged, $errorsCount
}
Write-Host $summary
Write-RunLog $summary
exit $exitCode
