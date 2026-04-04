param(
  [string]$ContainerName = "ironlog-postgres-alt",
  [string]$DbName = "ironlog",
  [string]$DbUser = "ironlog",
  [string]$DbPassword = "ironlog",
  [string]$OutputDir = "./backups",
  [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"

$resolvedOutputDir = Resolve-Path -Path $OutputDir -ErrorAction SilentlyContinue
if (-not $resolvedOutputDir) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
  $resolvedOutputDir = Resolve-Path -Path $OutputDir
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "ironlog-$timestamp.dump"
$outputFile = Join-Path $resolvedOutputDir.Path $fileName

Write-Host "Creating backup: $outputFile"

docker exec -e PGPASSWORD=$DbPassword $ContainerName pg_dump -U $DbUser -d $DbName -Fc > $outputFile
if ($LASTEXITCODE -ne 0) {
  throw "Backup failed with exit code $LASTEXITCODE"
}

Write-Host "Backup complete: $outputFile"

$cutoff = (Get-Date).AddDays(-1 * $RetentionDays)
Get-ChildItem -Path $resolvedOutputDir.Path -Filter "ironlog-*.dump" |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-Host "Removing old backup: $($_.FullName)"
    Remove-Item -Path $_.FullName -Force
  }
