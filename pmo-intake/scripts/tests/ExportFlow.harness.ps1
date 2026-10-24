<#
.SYNOPSIS
  Runs the control flow of Export-OutlookToInbox.ps1 against a FAKE Outlook.
  There is no Outlook, no COM object and no mailbox involved: a copy of the
  script is made with its single "New-Object -ComObject" line swapped for
  New-FakeOutlook (tests/FakeOutlook.ps1), and Get-Process is shadowed so the
  result does not depend on what is running on the machine. Everything is
  fictional and written under a temp folder.

.PARAMETER OutFile
  Where the results go (UTF-8, no BOM).

  ASCII only (Windows PowerShell 5.1 reads a BOM-less script as ANSI).
#>
param([Parameter(Mandatory = $true)][string]$OutFile)

$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $scriptsDir 'OutlookMapping.ps1')
. (Join-Path $PSScriptRoot 'FakeOutlook.ps1')

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('pmo-flow-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work)

# The script under test, with the one COM line replaced and the mapping path made absolute.
$text = [System.IO.File]::ReadAllText((Join-Path $scriptsDir 'Export-OutlookToInbox.ps1'))
$marker = "New-Object -ComObject 'Outlook.Application'"
if (-not $text.Contains($marker)) { throw 'The COM line was not found; update this harness.' }
$text = $text.Replace($marker, 'New-FakeOutlook')
$text = $text.Replace("(Join-Path `$PSScriptRoot 'OutlookMapping.ps1')", ("'" + (Join-Path $scriptsDir 'OutlookMapping.ps1') + "'"))
$copy = Join-Path $work 'Export-copy.ps1'
[System.IO.File]::WriteAllText($copy, $text, $utf8NoBom)

# Shadow Get-Process so "is Outlook running" is under the test's control.
$global:FakeProcesses = @()
function Get-Process {
  [CmdletBinding()]
  param([string]$Name)
  return @($global:FakeProcesses | Where-Object { $_ -ieq $Name } | ForEach-Object { [pscustomobject]@{ Name = $_ } })
}

$now = Get-Date
$mail = {
  param([string]$Id, [double]$DaysAgo, [hashtable]$Extra = @{})
  $when = $now.AddDays(-$DaysAgo)
  $o = @{ ReceivedTime = $when; CreationTime = $when; LastModificationTime = $when; Subject = ('Subject ' + $Id); EntryID = ('ENTRY-' + $Id) }
  foreach ($k in $Extra.Keys) { $o[$k] = $Extra[$k] }
  New-FakeMail $o ('<' + $Id + '@example.test>')
}

function Invoke-Run([string]$Label, [hashtable]$Config, [hashtable]$ScriptArgs, [string]$Inbox, [string]$State, [string[]]$Processes = @('OUTLOOK')) {
  $global:FakeOutlook = $Config
  $global:FakeOutlook['Calls'] = New-Object System.Collections.ArrayList
  $global:FakeProcesses = $Processes
  $global:LASTEXITCODE = 0
  $params = @{ InboxDir = $Inbox; StatePath = $State }
  foreach ($k in $ScriptArgs.Keys) { $params[$k] = $ScriptArgs[$k] }
  $text = & $copy @params *>&1 | Out-String
  [ordered]@{
    label = $Label
    exit  = [int]$global:LASTEXITCODE
    text  = $text
    calls = [string[]]@($global:FakeOutlook.Calls)
    files = [string[]]@(Get-ChildItem -LiteralPath $Inbox -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $_.Name })
    state = if (Test-Path -LiteralPath $State) { [System.IO.File]::ReadAllText($State) } else { $null }
  }
}

$runs = New-Object System.Collections.ArrayList
try {
  $inbox = Join-Path $work 'inbox'
  [void](New-Item -ItemType Directory -Path $inbox)
  $state = Join-Path $work 'state\seen.json'

  $meeting = & $mail 'meeting' 0.5 @{ Class = 53 }
  $pmoItems = @(
    (& $mail 'a1' 0.2),
    $meeting,
    (& $mail 'a2' 1),
    (& $mail 'old1' 40)
  )
  $cfg = { @{ Inbox = @(); Folders = @{ PMO = $pmoItems }; TopFolders = @{}; ToDo = @(); RestrictFails = 0; SortFails = $false; ComFails = $false } }

  # 1. Dry run: reads, prints, writes nothing (no file, no state).
  [void]$runs.Add((Invoke-Run 'dry-run' (& $cfg) @{ FolderPath = 'Inbox\PMO'; DryRun = $true } $inbox $state))
  # 2. -WhatIf is a dry run too.
  [void]$runs.Add((Invoke-Run 'whatif' (& $cfg) @{ FolderPath = 'Inbox\PMO'; WhatIf = $true } $inbox $state))
  # 3. Real run, then again (nothing new), then with -IgnoreSeen (same names).
  [void]$runs.Add((Invoke-Run 'real-1' (& $cfg) @{ FolderPath = 'Inbox\PMO' } $inbox $state))
  [void]$runs.Add((Invoke-Run 'real-2' (& $cfg) @{ FolderPath = 'Inbox\PMO' } $inbox $state))
  [void]$runs.Add((Invoke-Run 'real-ignore-seen' (& $cfg) @{ FolderPath = 'Inbox\PMO'; IgnoreSeen = $true } $inbox $state))
  # Clean up for the next scenarios.
  Get-ChildItem -LiteralPath $inbox | Remove-Item -Force
  Remove-Item -LiteralPath (Split-Path -Parent $state) -Recurse -Force

  # 4. -MaxItems 1: only the newest is written.
  $state2 = Join-Path $work 'state2\seen.json'
  [void]$runs.Add((Invoke-Run 'max-items' (& $cfg) @{ FolderPath = 'Inbox\PMO'; MaxItems = 1 } $inbox $state2))
  Get-ChildItem -LiteralPath $inbox | Remove-Item -Force

  # 5. Restrict: DASL fails, Jet works; both fail; sorting fails (scan everything).
  $c = & $cfg; $c.RestrictFails = 1
  [void]$runs.Add((Invoke-Run 'restrict-jet' $c @{ FolderPath = 'Inbox\PMO'; DryRun = $true } $inbox $state))
  $c = & $cfg; $c.RestrictFails = 2; $c.SortFails = $true
  [void]$runs.Add((Invoke-Run 'restrict-none-no-sort' $c @{ FolderPath = 'Inbox\PMO'; DryRun = $true } $inbox $state))

  # 6. A wider window picks up the old mail.
  [void]$runs.Add((Invoke-Run 'since-60' (& $cfg) @{ FolderPath = 'Inbox\PMO'; SinceDays = 60; DryRun = $true } $inbox $state))

  # 7. Flagged mode (no -FolderPath): only flagged mail, only the recent ones.
  $flagged = @(
    (& $mail 'f1' 0.1 @{ FlagStatus = 2 }),
    (& $mail 'f2' 0.2 @{ FlagStatus = 0 }),
    (& $mail 'task' 0.3 @{ Class = 48; FlagStatus = 2 }),
    (& $mail 'f3' 2 @{ FlagStatus = 2 }),
    (& $mail 'f-old' 90 @{ FlagStatus = 2 })
  )
  $c = & $cfg; $c.ToDo = $flagged
  [void]$runs.Add((Invoke-Run 'flagged' $c @{ DryRun = $true } $inbox $state))

  # 8. The Inbox itself, and a top-level folder.
  $c = & $cfg; $c.Inbox = @((& $mail 'i1' 0.1)); $c.TopFolders = @{ Archive = @((& $mail 'z1' 0.1)) }
  [void]$runs.Add((Invoke-Run 'inbox-itself' $c @{ FolderPath = 'Inbox'; DryRun = $true } $inbox $state))
  [void]$runs.Add((Invoke-Run 'top-level-folder' $c @{ FolderPath = 'Archive'; DryRun = $true } $inbox $state))

  # 9. Errors: a folder that is not there, a missing inbox, new Outlook, no COM.
  [void]$runs.Add((Invoke-Run 'folder-missing' (& $cfg) @{ FolderPath = 'Inbox\Nope'; DryRun = $true } $inbox $state))
  [void]$runs.Add((Invoke-Run 'inbox-missing-real' (& $cfg) @{ FolderPath = 'Inbox\PMO' } (Join-Path $work 'no-such-inbox') $state))
  [void]$runs.Add((Invoke-Run 'inbox-missing-dry' (& $cfg) @{ FolderPath = 'Inbox\PMO'; DryRun = $true } (Join-Path $work 'no-such-inbox') $state))
  [void]$runs.Add((Invoke-Run 'new-outlook' (& $cfg) @{ FolderPath = 'Inbox\PMO'; DryRun = $true } $inbox $state @('olk')))
  $c = & $cfg; $c.ComFails = $true
  [void]$runs.Add((Invoke-Run 'no-com' $c @{ FolderPath = 'Inbox\PMO'; DryRun = $true } $inbox $state))

  # 10. The guard prompt denied on three messages in a row: the run stops (exit 4).
  $denied = [System.Runtime.InteropServices.COMException]::new('Operation aborted', -2147467260)
  $guardItems = 1..5 | ForEach-Object {
    & $mail ('g' + $_) 0.1 @{
      SenderEmailAddress = $xPat; SenderEmailType = 'EX'
      Sender = (New-Object psobject -Property @{ Type = 'EX'; Denied = $denied } | Add-Member -MemberType ScriptMethod -Name GetExchangeUser -Value { throw $this.Denied } -PassThru)
      PropertyAccessor = (New-Accessor @{ $script:PrInternetMessageId = ('<g' + $_ + '@example.test>'); $script:PrSenderSmtpAddress = $denied })
    }
  }
  $c = & $cfg; $c.Folders = @{ PMO = $guardItems }
  [void]$runs.Add((Invoke-Run 'guard-stop' $c @{ FolderPath = 'Inbox\PMO'; DryRun = $true } $inbox $state))

  # What a written file looks like.
  $realInbox = Join-Path $work 'inbox-real'
  [void](New-Item -ItemType Directory -Path $realInbox)
  $run = Invoke-Run 'write-sample' (& $cfg) @{ FolderPath = 'Inbox\PMO' } $realInbox (Join-Path $work 'state3\seen.json')
  $run['firstFile'] = [System.IO.File]::ReadAllText((Join-Path $realInbox $run.files[0]))
  $run['firstBytes'] = [int[]]@([System.IO.File]::ReadAllBytes((Join-Path $realInbox $run.files[0]))[0..2])
  [void]$runs.Add($run)
} finally {
  [System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject ([ordered]@{ runs = [object[]]$runs.ToArray() }) -Depth 6), $utf8NoBom)
  Remove-Item -LiteralPath $work -Recurse -Force
}
