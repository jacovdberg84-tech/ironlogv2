$ErrorActionPreference = "Stop"

$scriptPath = "c:\IRONLOG v2\scripts\db-backup.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath `
  -ContainerName "ironlog-postgres-alt" `
  -OutputDir "c:\IRONLOG v2\backups" `
  -RetentionDays 14
