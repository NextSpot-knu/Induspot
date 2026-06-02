<#
  InduSpot deploy automation (PowerShell)

  Usage (from repo root):
    .\deploy.ps1                 # all (backend + gateway + frontend)
    .\deploy.ps1 -Frontend       # frontend only (most changes)
    .\deploy.ps1 -Backend        # Cloud Run backend only
    .\deploy.ps1 -Backend -Gateway   # backend + gateway (when openapi changed)

  - Deploys backend / gateway / frontend in order; stops on the first failure.
  - The gateway api-config name is auto-generated with a timestamp (always unique).
  - Machine-specific paths (gcloud / SA key) use the defaults below; override via params.
#>

param(
  [switch]$Backend,
  [switch]$Gateway,
  [switch]$Frontend,
  [string]$Gcloud = "C:\Users\samsung-user\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
  [string]$SaKey  = "C:\Users\samsung-user\Desktop\Google_Challenge\knudc-henryseo711-775e5ed806b7.json"
)

$ErrorActionPreference = "Stop"

# Fixed config
$ProjectId       = "knudc-henryseo711"
$Region          = "asia-northeast3"
$Service         = "induspot-api"
$GatewayApi      = "induspot-gateway-api"
$GatewayId       = "induspot-gateway"
$GatewayLocation = "us-central1"
$BackendAuthSA   = "768699236852-compute@developer.gserviceaccount.com"
$GatewayUrl      = "https://induspot-gateway-9t4vof78.uc.gateway.dev"

# Move to repo root (this script's directory)
Set-Location $PSScriptRoot

# No flags => deploy everything
if (-not ($Backend -or $Gateway -or $Frontend)) {
  $Backend = $true; $Gateway = $true; $Frontend = $true
}

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }

if (-not (Test-Path $Gcloud)) { throw "gcloud not found: $Gcloud  (use -Gcloud to set the path)" }

# (a) Cloud Run (backend)
if ($Backend) {
  Step "(a) Cloud Run deploy ($Service) - existing secrets/env preserved"
  & $Gcloud run deploy $Service --source apps/api --region $Region --project $ProjectId --quiet
  if ($LASTEXITCODE -ne 0) { throw "Cloud Run deploy failed (exit $LASTEXITCODE)" }
  Ok "Cloud Run deployed"
}

# (b) API Gateway (when openapi changed)
if ($Gateway) {
  Step "(b) API Gateway update (create new config, then switch)"
  $cfg = "induspot-config-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  & $Gcloud api-gateway api-configs create $cfg `
      --api=$GatewayApi `
      --openapi-spec=apps/api/openapi-gateway.yaml `
      --backend-auth-service-account=$BackendAuthSA `
      --project=$ProjectId
  if ($LASTEXITCODE -ne 0) { throw "Gateway api-config create failed (exit $LASTEXITCODE)" }

  # Switch via REST PATCH with an explicit updateMask.
  # (gcloud 'gateways update --api-config' sends an empty update_mask -> INVALID_ARGUMENT bug)
  $cfgPath = "projects/$ProjectId/locations/global/apis/$GatewayApi/configs/$cfg"
  $token = (& $Gcloud auth print-access-token).Trim()
  $patchUri = "https://apigateway.googleapis.com/v1/projects/$ProjectId/locations/$GatewayLocation/gateways/$GatewayId`?updateMask=apiConfig"
  Invoke-RestMethod -Method Patch -Uri $patchUri `
      -Headers @{ Authorization = "Bearer $token" } `
      -ContentType "application/json" `
      -Body (@{ apiConfig = $cfgPath } | ConvertTo-Json) | Out-Null
  Ok "Gateway -> $cfg switch requested (applies within ~1-2 min)"
}

# (c) Frontend (Firebase Hosting)
if ($Frontend) {
  Step "(c) Frontend build (Next static export, webpack)"
  $env:NODE_OPTIONS = "--max-old-space-size=6144"
  $env:NEXT_PUBLIC_API_GATEWAY_URL = $GatewayUrl  # embed gateway URL (other keys come from .env.local)
  & npm run build --workspace=apps/web -- --webpack
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)" }
  Ok "Build done (apps/web/out)"

  Step "(c) Firebase Hosting deploy (target: induspot)"
  if (-not (Test-Path $SaKey)) { throw "SA key not found: $SaKey  (use -SaKey to set the path)" }
  $env:GOOGLE_APPLICATION_CREDENTIALS = $SaKey
  & npx --yes firebase-tools@latest deploy --only "hosting:induspot" --project $ProjectId --non-interactive
  if ($LASTEXITCODE -ne 0) { throw "Firebase deploy failed (exit $LASTEXITCODE)" }
  Ok "Frontend deployed -> https://induspot.web.app"
}

Write-Host "`n=== Deploy complete. Hard-refresh the browser (Ctrl+Shift+R) ===" -ForegroundColor Green
