<#
.SYNOPSIS
  FAKE Outlook objects (plain PSCustomObjects with script methods) for the
  producer's tests. Dot-sourced by OutlookMapping.harness.ps1 and
  ExportFlow.harness.ps1. There is no COM object in here and nothing touches a
  mailbox; all content is fictional. Load OutlookMapping.ps1 first (the MAPI
  property-tag constants come from it).

  ASCII only (Windows PowerShell 5.1 reads a BOM-less script as ANSI).
#>

function New-ComError([string]$Message, [int]$HResult) {
  return [System.Runtime.InteropServices.COMException]::new($Message, $HResult)
}

# PropertyAccessor.GetProperty(tag): a value from the table, a thrown exception
# if the table holds an exception, or "property not found".
function New-Accessor([hashtable]$Props) {
  $o = New-Object psobject -Property @{ Props = $Props }
  $o | Add-Member -MemberType ScriptMethod -Name GetProperty -Value {
    param($tag)
    if ($this.Props.ContainsKey($tag)) {
      $v = $this.Props[$tag]
      if ($v -is [System.Exception]) { throw $v }
      return $v
    }
    throw [System.Runtime.InteropServices.COMException]::new('Property not found', -2147221233)
  }
  return $o
}

# AddressEntry: Type 'EX' or 'SMTP'; GetExchangeUser() returns an object with
# PrimarySmtpAddress, $null, or throws.
function New-AddressEntry([string]$Type, $Smtp, [switch]$Throws) {
  $o = New-Object psobject -Property @{ Type = $Type; Smtp = $Smtp; Throws = [bool]$Throws }
  $o | Add-Member -MemberType ScriptMethod -Name GetExchangeUser -Value {
    if ($this.Throws) { throw [System.Runtime.InteropServices.COMException]::new('The server is not available', -2147467259) }
    if ($null -eq $this.Smtp) { return $null }
    return (New-Object psobject -Property @{ PrimarySmtpAddress = $this.Smtp })
  }
  return $o
}

function New-Recipient([string]$Name, [string]$Address, [int]$Type, $Entry, $Accessor) {
  if ($null -eq $Accessor) { $Accessor = New-Accessor @{} }
  New-Object psobject -Property @{ Name = $Name; Address = $Address; Type = $Type; AddressEntry = $Entry; PropertyAccessor = $Accessor }
}

$xPat = '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=0123456789abcdef-pat.sample'
$xJordan = '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=fedcba9876543210-jordan'

# A fake MailItem. Overrides replace any default; -MessageId sets the Internet
# Message-ID (the EntryID is a fixed fake unless overridden).
function New-FakeMail {
  param([hashtable]$Overrides = @{}, [string]$MessageId = '<fake-0001@example.test>')
  $base = @{
    Class                = 43
    Subject              = 'Q4 programme status pack - input needed'
    Body                 = "Hi Alwin,`r`n`r`nPlease send the RAID log by Tuesday.`r`n`r`nThanks,`r`nPat"
    HTMLBody             = ''
    SenderName           = 'Pat Sample'
    SenderEmailAddress   = 'pat.sample@deloitte.com'
    SenderEmailType      = 'SMTP'
    Sender               = (New-AddressEntry 'SMTP' $null)
    Recipients           = @(
      (New-Recipient 'Alwin Saju' 'alsaju@deloitte.com' 1 (New-AddressEntry 'SMTP' $null) $null),
      (New-Recipient 'Jordan Sample' 'jordan.sample@deloitte.com' 2 (New-AddressEntry 'SMTP' $null) $null)
    )
    Attachments          = @()
    ReceivedTime         = [datetime]'2026-10-22T09:14:00'
    CreationTime         = [datetime]'2026-10-22T09:14:00'
    LastModificationTime = [datetime]'2026-10-22T09:14:00'
    FlagStatus           = 0
    EntryID              = '00000000FAKEENTRYID0001'
    ConversationID       = 'FAKECONVERSATION0001'
    Importance           = 1
    PropertyAccessor     = (New-Accessor @{ $script:PrInternetMessageId = $MessageId })
  }
  foreach ($k in $Overrides.Keys) { $base[$k] = $Overrides[$k] }
  return (New-Object psobject -Property $base)
}

# --- a fake Outlook.Application graph -----------------------------------------
# Configure with $global:FakeOutlook = @{ ... } before running a script whose
# New-Object -ComObject line was swapped for New-FakeOutlook:
#   Inbox        mail items in the default Inbox (newest first)
#   Folders      @{ 'PMO' = @(items) } subfolders of the Inbox, and top-level folders
#   ToDo         items in the To-Do (flagged mail) search folder
#   RestrictFails  how many Restrict() calls throw before one works (0, 1, 2...)
#   SortFails    Sort() throws
#   Calls        (output) a log of the calls the script made
function New-FakeItems($Source) {
  $o = New-Object psobject -Property @{ Source = @($Source); Cursor = 0 }
  $o | Add-Member -MemberType ScriptMethod -Name Restrict -Value {
    param($filter)
    [void]$global:FakeOutlook.Calls.Add(('Restrict: ' + $filter))
    if ($global:FakeOutlook.RestrictFails -gt 0) {
      $global:FakeOutlook.RestrictFails--
      throw [System.Runtime.InteropServices.COMException]::new('Cannot parse condition', -2147352567)
    }
    return $this
  }
  $o | Add-Member -MemberType ScriptMethod -Name Sort -Value {
    param($field, $descending)
    [void]$global:FakeOutlook.Calls.Add(('Sort: ' + $field))
    if ($global:FakeOutlook.SortFails) { throw [System.Runtime.InteropServices.COMException]::new('Sort failed', -2147352567) }
  }
  $o | Add-Member -MemberType ScriptMethod -Name GetFirst -Value {
    $this.Cursor = 0
    if ($this.Source.Count -eq 0) { return $null }
    return $this.Source[0]
  }
  $o | Add-Member -MemberType ScriptMethod -Name GetNext -Value {
    $this.Cursor++
    if ($this.Cursor -ge $this.Source.Count) { return $null }
    return $this.Source[$this.Cursor]
  }
  return $o
}

function New-FakeFolder([string]$Name, $Items, $Children, $Parent) {
  $folders = New-Object psobject -Property @{ Children = $Children }
  $folders | Add-Member -MemberType ScriptMethod -Name Item -Value {
    param($name)
    if ($this.Children -and $this.Children.ContainsKey($name)) { return $this.Children[$name] }
    throw [System.Runtime.InteropServices.COMException]::new('Cannot find the folder', -2147221233)
  }
  $f = New-Object psobject -Property @{ Name = $Name; Items = (New-FakeItems $Items); Folders = $folders; Parent = $Parent }
  return $f
}

function New-FakeOutlook {
  $cfg = $global:FakeOutlook
  if ($cfg.ComFails) { throw [System.Runtime.InteropServices.COMException]::new('Class not registered', -2147221164) }
  $children = @{}
  $topChildren = @{}
  foreach ($name in $cfg.Folders.Keys) {
    $children[$name] = New-FakeFolder $name $cfg.Folders[$name] @{} $null
  }
  foreach ($name in $cfg.TopFolders.Keys) {
    $topChildren[$name] = New-FakeFolder $name $cfg.TopFolders[$name] @{} $null
  }
  $root = New-FakeFolder 'Mailbox - Alwin Sample' @() $topChildren $null
  $inbox = New-FakeFolder 'Inbox' $cfg.Inbox $children $root
  $topChildren['Inbox'] = $inbox
  $todo = New-FakeFolder 'To-Do' $cfg.ToDo @{} $root
  $ns = New-Object psobject -Property @{
    Inbox = $inbox; ToDo = $todo
    CurrentUser = (New-Object psobject -Property @{ Address = 'alsaju@deloitte.com'; AddressEntry = (New-AddressEntry 'EX' 'alsaju@deloitte.com') })
  }
  $ns | Add-Member -MemberType ScriptMethod -Name GetDefaultFolder -Value {
    param($which)
    [void]$global:FakeOutlook.Calls.Add(('GetDefaultFolder: ' + $which))
    if ($which -eq 6) { return $this.Inbox }
    if ($which -eq 28) { return $this.ToDo }
    throw [System.Runtime.InteropServices.COMException]::new('Unknown folder', -2147221233)
  }
  $app = New-Object psobject -Property @{ Namespace = $ns }
  $app | Add-Member -MemberType ScriptMethod -Name GetNamespace -Value {
    param($kind)
    [void]$global:FakeOutlook.Calls.Add(('GetNamespace: ' + $kind))
    return $this.Namespace
  }
  return $app
}
