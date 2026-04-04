param(
  [string]$ApiBase = "http://localhost:4000",
  [string]$Email = "admin@ironlog.local",
  [string]$Password = "ChangeMe123!"
)

$ErrorActionPreference = "Stop"

Write-Host "[1/3] Checking startup health"
$health = Invoke-RestMethod -Method Get -Uri "$ApiBase/health/startup"
if ($health.status -ne "ok") {
  throw "Startup health degraded: $($health | ConvertTo-Json -Depth 6)"
}

Write-Host "[2/3] Authenticating"
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/auth/login" -ContentType "application/json" -Body $loginBody
if (-not $login.token) {
  throw "Login did not return token"
}

Write-Host "[3/3] Calling protected endpoint"
$headers = @{ Authorization = "Bearer $($login.token)" }
$kpis = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/plant/kpis" -Headers $headers

$result = [pscustomobject]@{
  startupStatus = $health.status
  tokenIssued = [bool]$login.token
  kpiMaintenanceMtbf = $kpis.maintenance.mtbf
  timestamp = (Get-Date).ToString("o")
}

Write-Host "Smoke test passed"
$result | ConvertTo-Json -Depth 6
