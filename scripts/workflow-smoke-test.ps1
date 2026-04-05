param(
  [string]$ApiBase = "http://localhost:4000",
  [string]$Email = "admin@ironlog.local",
  [string]$Password = "ChangeMe123!",
  [string]$SiteCode = "SITE-A"
)

$ErrorActionPreference = "Stop"

Write-Host "[1/5] Checking startup health"
$health = Invoke-RestMethod -Method Get -Uri "$ApiBase/health/startup"
if ($health.status -ne "ok") {
  throw "Startup health degraded: $($health | ConvertTo-Json -Depth 6)"
}

Write-Host "[2/5] Authenticating"
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/auth/login" -ContentType "application/json" -Body $loginBody
if (-not $login.token) {
  throw "Login did not return token"
}

$headers = @{ Authorization = "Bearer $($login.token)"; "Content-Type" = "application/json" }

Write-Host "[3/5] Creating workflow test work orders"
$stamp = (Get-Date).ToString("yyyyMMddHHmmss")
$parentPayload = @{
  siteCode = $SiteCode
  department = "operations"
  machineCode = "MCH-WF-$stamp"
  title = "Workflow smoke parent $stamp"
  description = "Parent work order for workflow smoke dependency"
  priority = "high"
  assignedToName = "Shift Lead"
  estimatedCost = 1000
  downtimeHours = 1
} | ConvertTo-Json
$parent = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/work-orders" -Headers $headers -Body $parentPayload

$childPayload = @{
  siteCode = $SiteCode
  department = "operations"
  machineCode = "MCH-WFC-$stamp"
  title = "Workflow smoke child $stamp"
  description = "Child work order for workflow checklist/comment/dependency"
  priority = "medium"
  assignedToName = "Operator B"
  estimatedCost = 500
  downtimeHours = 0.25
} | ConvertTo-Json
$child = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/work-orders" -Headers $headers -Body $childPayload

Write-Host "[4/5] Exercising checklist, comments, and dependencies"
$checklistPayload = @{
  title = "Verify lockout-tagout"
  assigneeName = "Operator B"
} | ConvertTo-Json
$checklistItem = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/work-orders/$($child.id)/checklist" -Headers $headers -Body $checklistPayload

$checklistUpdated = Invoke-RestMethod -Method Patch -Uri "$ApiBase/api/work-orders/$($child.id)/checklist/$($checklistItem.id)" -Headers $headers -Body (@{ status = "done" } | ConvertTo-Json)
$comment = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/work-orders/$($child.id)/comments" -Headers $headers -Body (@{ message = "Workflow smoke comment $stamp" } | ConvertTo-Json)
$dependency = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/work-orders/$($child.id)/dependencies" -Headers $headers -Body (@{ dependsOnWorkOrderId = $parent.id } | ConvertTo-Json)

$checklist = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/work-orders/$($child.id)/checklist" -Headers @{ Authorization = "Bearer $($login.token)" }
$comments = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/work-orders/$($child.id)/comments?limit=20" -Headers @{ Authorization = "Bearer $($login.token)" }
$dependencies = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/work-orders/$($child.id)/dependencies" -Headers @{ Authorization = "Bearer $($login.token)" }
$board = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/work-orders/workflow/board?siteCode=$SiteCode&limit=200" -Headers @{ Authorization = "Bearer $($login.token)" }

if ($checklistUpdated.status -ne "done") {
  throw "Checklist item did not update to done status"
}
if (-not $comment.id) {
  throw "Comment endpoint did not return an id"
}
if (-not $dependency.dependsOnWorkOrderId) {
  throw "Dependency endpoint did not return dependency payload"
}
if (($board.lanes.PSObject.Properties | Measure-Object).Count -lt 7) {
  throw "Workflow board lanes were incomplete"
}

Write-Host "[5/5] Workflow smoke result"
$result = [pscustomobject]@{
  startupStatus = $health.status
  parentWorkOrderId = $parent.id
  childWorkOrderId = $child.id
  checklistItemId = $checklistItem.id
  checklistStatus = $checklistUpdated.status
  commentId = $comment.id
  dependencyTarget = $dependency.dependsOnWorkOrderId
  checklistCount = ($checklist.items | Measure-Object).Count
  commentsCount = ($comments.items | Measure-Object).Count
  dependenciesCount = ($dependencies.items | Measure-Object).Count
  laneCount = ($board.lanes.PSObject.Properties | Measure-Object).Count
  timestamp = (Get-Date).ToString("o")
}

Write-Host "Workflow smoke test passed"
$result | ConvertTo-Json -Depth 6
