param(
  [string]$ContainerName = "ironlog-postgres-alt",
  [string]$DbName = "ironlog",
  [string]$DbUser = "ironlog",
  [string]$DbPassword = "ironlog",
  [Parameter(Mandatory = $true)]
  [string]$BackupFile
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}

$resolvedBackup = (Resolve-Path -Path $BackupFile).Path

Write-Host "Restoring backup: $resolvedBackup"
Write-Host "Target: $ContainerName / $DbName"

Get-Content -Path $resolvedBackup -Encoding Byte -ReadCount 0 |
  docker exec -i -e PGPASSWORD=$DbPassword $ContainerName pg_restore -U $DbUser -d $DbName --clean --if-exists

if ($LASTEXITCODE -ne 0) {
  throw "Restore failed with exit code $LASTEXITCODE"
}

Write-Host "Restore complete"
