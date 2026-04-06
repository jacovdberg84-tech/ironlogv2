param(
  [string]$ApiBase = "https://deploy.ironloggroup.com",
  [string]$Email = "admin@ironlog.local",
  [string]$Password = "ChangeMe123!",
  [string]$SiteCode = "SITE-A",
  [string]$DeployWebhookToken = $env:DEPLOY_WEBHOOK_TOKEN,
  [switch]$SkipWorkflow,
  [switch]$SkipTls,
  [string]$BackupPath,
  [int]$MaxBackupAgeHours = 24
)

$ErrorActionPreference = "Stop"

function Invoke-SmokeScript {
  param(
    [string]$Name,
    [string]$ScriptPath,
    [string[]]$Arguments
  )

  Write-Host "Running: $Name"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Test-WebhookReachability {
  param(
    [string]$Base,
    [string]$Token
  )

  $uri = "$Base/webhook"
  $body = @{ probe = "post-deploy-smoke" } | ConvertTo-Json
  $headers = @{}
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $headers.Authorization = "Bearer $Token"
  }

  try {
    $response = Invoke-WebRequest -Method Post -Uri $uri -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 20
    return [pscustomobject]@{
      url = $uri
      statusCode = [int]$response.StatusCode
      reachable = $true
      authenticated = -not [string]::IsNullOrWhiteSpace($Token)
    }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    # Without token, 401/403 still confirms route reachability.
    # With token, accept only valid execution statuses.
    $isAuthenticatedProbe = -not [string]::IsNullOrWhiteSpace($Token)
    $acceptedCodes = if ($isAuthenticatedProbe) { @(200, 202, 409) } else { @(200, 202, 400, 401, 403, 409) }

    if ($statusCode -in $acceptedCodes) {
      return [pscustomobject]@{
        url = $uri
        statusCode = $statusCode
        reachable = $true
        authenticated = $isAuthenticatedProbe
      }
    }

    if ($isAuthenticatedProbe -and $statusCode -in @(401, 403)) {
      throw "Webhook token rejected (HTTP $statusCode). Ensure DEPLOY_WEBHOOK_TOKEN matches /etc/ironlog/deploy-webhook.env on the server and GitHub environment secret DEPLOY_WEBHOOK_TOKEN."
    }

    throw "Webhook endpoint check failed for $uri. $($_.Exception.Message)"
  }
}

function Get-TlsCertificateSummary {
  param([string]$Base)

  $uri = [Uri]$Base
  if ($uri.Scheme -ne "https") {
    return [pscustomobject]@{
      skipped = $true
      reason = "ApiBase is not https"
    }
  }

  $tcp = $null
  $ssl = $null

  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 443 }
    $tcp.Connect($uri.Host, $port)
    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, ({ $true }))
    $ssl.AuthenticateAsClient($uri.Host)

    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $ssl.RemoteCertificate
    return [pscustomobject]@{
      host = $uri.Host
      issuer = $cert.Issuer
      subject = $cert.Subject
      notAfter = $cert.NotAfter.ToString("o")
      daysRemaining = [math]::Round(($cert.NotAfter - (Get-Date)).TotalDays, 2)
      skipped = $false
    }
  } finally {
    if ($ssl) { $ssl.Dispose() }
    if ($tcp) { $tcp.Dispose() }
  }
}

function Get-BackupSummary {
  param(
    [string]$Path,
    [int]$MaxAgeHours
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return [pscustomobject]@{
      skipped = $true
      reason = "BackupPath not provided"
    }
  }

  if (-not (Test-Path -Path $Path)) {
    throw "BackupPath not found: $Path"
  }

  $latest = Get-ChildItem -Path $Path -Filter "ironlog-*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latest) {
    throw "No backup dump files found in $Path"
  }

  $ageHours = [math]::Round(((Get-Date) - $latest.LastWriteTime).TotalHours, 2)
  if ($ageHours -gt $MaxAgeHours) {
    throw "Latest backup is stale ($ageHours hours old), max allowed is $MaxAgeHours"
  }

  return [pscustomobject]@{
    skipped = $false
    latestFile = $latest.FullName
    ageHours = $ageHours
    maxAllowedHours = $MaxAgeHours
  }
}

$summary = [ordered]@{}
$failedChecks = New-Object System.Collections.Generic.List[string]

try {
  Invoke-SmokeScript -Name "Startup smoke" -ScriptPath "./scripts/smoke-test.ps1" -Arguments @("-ApiBase", $ApiBase, "-Email", $Email, "-Password", $Password)
  $summary.startupSmoke = "passed"
} catch {
  $summary.startupSmoke = "failed"
  $failedChecks.Add("startupSmoke")
  Write-Error $_
}

if (-not $SkipWorkflow) {
  try {
    Invoke-SmokeScript -Name "Workflow smoke" -ScriptPath "./scripts/workflow-smoke-test.ps1" -Arguments @("-ApiBase", $ApiBase, "-Email", $Email, "-Password", $Password, "-SiteCode", $SiteCode)
    $summary.workflowSmoke = "passed"
  } catch {
    $summary.workflowSmoke = "failed"
    $failedChecks.Add("workflowSmoke")
    Write-Error $_
  }
} else {
  $summary.workflowSmoke = "skipped"
}

try {
  $summary.webhook = Test-WebhookReachability -Base $ApiBase -Token $DeployWebhookToken
} catch {
  $summary.webhook = [pscustomobject]@{ reachable = $false; message = $_.Exception.Message }
  $failedChecks.Add("webhook")
}

if (-not $SkipTls) {
  try {
    $summary.tls = Get-TlsCertificateSummary -Base $ApiBase
  } catch {
    $summary.tls = [pscustomobject]@{ skipped = $false; message = $_.Exception.Message }
    $failedChecks.Add("tls")
  }
} else {
  $summary.tls = [pscustomobject]@{ skipped = $true; reason = "SkipTls flag enabled" }
}

try {
  $summary.backup = Get-BackupSummary -Path $BackupPath -MaxAgeHours $MaxBackupAgeHours
} catch {
  $summary.backup = [pscustomobject]@{ skipped = $false; message = $_.Exception.Message }
  $failedChecks.Add("backup")
}

$result = [pscustomobject]@{
  apiBase = $ApiBase
  checkedAt = (Get-Date).ToString("o")
  failedChecks = $failedChecks
  summary = $summary
}

$result | ConvertTo-Json -Depth 8

if ($failedChecks.Count -gt 0) {
  throw "Post-deploy smoke failed: $($failedChecks -join ', ')"
}

Write-Host "Post-deploy smoke passed"
