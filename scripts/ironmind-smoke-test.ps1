param(
  [string]$ApiBase = "http://localhost:4000",
  [string]$Email = "admin@ironlog.local",
  [string]$Password = "ChangeMe123!"
)

$ErrorActionPreference = "Stop"

Write-Host "[1/7] Startup health"
$health = Invoke-RestMethod -Method Get -Uri "$ApiBase/health/startup"
if ($health.status -ne "ok") {
  throw "Startup health degraded: $($health | ConvertTo-Json -Depth 6)"
}

Write-Host "[2/7] Auth"
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/auth/login" -ContentType "application/json" -Body $loginBody
if (-not $login.token) {
  throw "Login did not return token"
}
$token = $login.token
$authHeaders = @{ Authorization = "Bearer $token" }
$jsonHeaders = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

Write-Host "[3/7] Ensure at least one fault rule"
$rules = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/admin/automation/fault-rules" -Headers $authHeaders
if ((($rules.items | Measure-Object).Count) -eq 0) {
  $rulePayload = @{
    name = "Default recurring hydraulic fault"
    enabled = $true
    occurrenceThreshold = 2
    windowHours = 24
    channel = "email"
    recipient = "shift.control@ironlog.local"
  } | ConvertTo-Json

  $null = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/admin/automation/fault-rules" -Headers $jsonHeaders -Body $rulePayload
  $rules = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/admin/automation/fault-rules" -Headers $authHeaders
}

Write-Host "[4/7] Post two fault events"
$stamp = (Get-Date).ToUniversalTime().ToString("o")
$eventPayload = @{
  machineCode = "EQ-SMOKE-001"
  faultCode = "HYD-LEAK"
  severity = "high"
  notes = "Ironmind smoke event"
  occurredAt = $stamp
} | ConvertTo-Json
$createdA = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/ironmind/faults/events" -Headers $jsonHeaders -Body $eventPayload
$createdB = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/ironmind/faults/events" -Headers $jsonHeaders -Body $eventPayload

Write-Host "[5/7] Read intel endpoints"
$overview = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/ironmind/intel/overview?hours=168" -Headers $authHeaders
$timeline = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/ironmind/intel/timeline?machineCode=EQ-SMOKE-001&limit=20" -Headers $authHeaders
$recommendations = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/ironmind/intel/recommendations?hours=168" -Headers $authHeaders
$predictive = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/ironmind/intel/predictive?horizonHours=72&windowHours=336" -Headers $authHeaders

Write-Host "[6/7] Create and close investigation case"
$casePayload = @{
  machineCode = "EQ-SMOKE-001"
  faultCode = "HYD-LEAK"
  severity = "high"
  title = "Smoke case"
  description = "Smoke test case"
  ownerName = "Shift Lead"
} | ConvertTo-Json
$case = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/ironmind/cases" -Headers $jsonHeaders -Body $casePayload
$caseId = [int]$case.id
if (-not $caseId) {
  throw "Create case response missing id"
}
$null = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/ironmind/cases/$caseId/actions" -Headers $jsonHeaders -Body (@{ actionTitle = "Inspect"; ownerName = "Planner" } | ConvertTo-Json)
$null = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/ironmind/cases/$caseId/close" -Headers $jsonHeaders -Body (@{ closureSummary = "Smoke completed" } | ConvertTo-Json)
$cases = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/ironmind/cases?limit=20" -Headers $authHeaders
$notifications = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/ironmind/faults/notifications" -Headers $authHeaders

Write-Host "[7/7] Validate and output"
if (($overview.totals.events -as [int]) -lt 1) {
  throw "Overview returned no events"
}
if ((($timeline.timeline | Measure-Object).Count) -lt 1) {
  throw "Timeline returned no events"
}
if ((($recommendations.recommendations | Measure-Object).Count) -lt 1) {
  throw "Recommendations returned no items"
}
if ((($predictive.machines | Measure-Object).Count) -lt 1) {
  throw "Predictive returned no machines"
}
if ((($cases.items | Measure-Object).Count) -lt 1) {
  throw "Cases endpoint returned no data"
}

$result = [pscustomobject]@{
  startup = $health.status
  ruleCount = ($rules.items | Measure-Object).Count
  createdEvents = @($createdA.eventId, $createdB.eventId)
  overviewEvents = $overview.totals.events
  timelineCount = ($timeline.timeline | Measure-Object).Count
  recommendationCount = ($recommendations.recommendations | Measure-Object).Count
  predictiveMachines = ($predictive.machines | Measure-Object).Count
  notificationsCount = ($notifications.items | Measure-Object).Count
  casesCount = ($cases.items | Measure-Object).Count
  timestamp = (Get-Date).ToString("o")
}

Write-Host "Ironmind smoke test passed"
$result | ConvertTo-Json -Depth 6
