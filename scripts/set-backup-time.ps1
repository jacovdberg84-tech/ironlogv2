param(
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$Time = "06:00",
  [string]$TaskName = "IRONLOG Daily DB Backup",
  [string]$BackupRunnerPath = "c:\IRONLOG v2\scripts\db-backup-daily.ps1"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $BackupRunnerPath)) {
  throw "Backup runner script not found: $BackupRunnerPath"
}

$atTime = [datetime]::ParseExact($Time, "HH:mm", $null)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File \"$BackupRunnerPath\""
$trigger = New-ScheduledTaskTrigger -Daily -At $atTime

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger | Out-Null
  $mode = "updated"
} else {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Description "Daily IRONLOG PostgreSQL backup" -User $env:USERNAME -RunLevel Limited -Force | Out-Null
  $mode = "created"
}

$info = Get-ScheduledTaskInfo -TaskName $TaskName
$result = [pscustomobject]@{
  taskName = $TaskName
  mode = $mode
  configuredTime = $Time
  nextRunTime = $info.NextRunTime.ToString("o")
  lastRunTime = $info.LastRunTime.ToString("o")
  lastTaskResult = $info.LastTaskResult
}

Write-Host "Backup schedule ${mode}: $TaskName at $Time"
$result | ConvertTo-Json -Depth 4
