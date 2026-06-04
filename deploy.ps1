<#
  InduSpot deploy automation (PowerShell)

  Usage (from repo root):
    .\deploy.ps1                 # all (backend + gateway + frontend). Backend RE-SEEDS facility embeddings first.
    .\deploy.ps1 -Frontend       # frontend only (most changes)
    .\deploy.ps1 -Backend        # Cloud Run backend only (re-seeds facility embeddings -> deploy)
    .\deploy.ps1 -Backend -SkipReseed  # backend deploy WITHOUT re-seeding embeddings (faster routine redeploy)
    .\deploy.ps1 -Backend -Gateway   # backend + gateway (when openapi changed)
    .\deploy.ps1 -Backend -Provision  # one-time idempotent GCP setup: IAM+secrets+Firestore+BQ (pre-deploy) -> deploy -> Pub/Sub (post-deploy, needs the image)
    .\deploy.ps1 -WithStreaming  # OPTIONAL heavier step: launch/refresh the Dataflow streaming job (separate from the Cloud Run image)

  - Deploys backend / gateway / frontend in order; stops on the first failure.
  - The gateway api-config name is auto-generated with a timestamp (always unique).
  - Machine-specific paths (gcloud / SA key) use the defaults below; override via params.
#>

param(
  [switch]$Backend,
  [switch]$Gateway,
  [switch]$Frontend,
  [switch]$Provision,
  [switch]$WithStreaming,
  [switch]$SkipReseed,
  [string]$Gcloud = "C:\Users\samsung-user\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
  # SA key actual location is Docs\ (was previously the repo-parent root; corrected so frontend deploy / SA-pinned
  # provisioning don't silently no-op). SECURITY.md tracks removing this local key (WIF / CI-only Firebase deploy).
  [string]$SaKey  = "C:\Users\samsung-user\Desktop\Google_Challenge\Docs\knudc-henryseo711-775e5ed806b7.json"
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
$IngestAudience  = "https://induspot-api-to7m2nnlca-du.a.run.app/ingest/pubsub"

# Canonical production env injected into Cloud Run (SINGLE SOURCE OF TRUTH for the live AI/OIDC activation flags).
# Previously these were a magic inline string on the deploy line; hoisted here so the live activation state is
# reviewable in one committed place. .env.example documents the same keys for local dev; config.py holds safe
# OFF defaults so a missing injection degrades gracefully (Vertex->GCS, Gemini->template, embeddings->Gemini ids).
$ProdEnvVars = @(
  "VERTEX_ENDPOINT_ID=2992545745120264192",                 # WP1: GCS-pickle fallback -> live Vertex online RPC
  "GEMINI_ENABLED=true",                                     # WP3: Vertex Gemini reasoning (fallback = template)
  "EMBEDDING_ENABLED=true",                                  # voice menu semantic search (Vertex embeddings + Firestore)
  "PUBSUB_PUSH_SERVICE_ACCOUNT=$BackendAuthSA",              # WP4: OIDC verify identity on /ingest/pubsub
  "PUBSUB_PUSH_AUDIENCE=$IngestAudience"                     # WP4: expected OIDC audience (empty would skip verify)
) -join ","

# Move to repo root (this script's directory)
Set-Location $PSScriptRoot

# No flags => deploy everything (Provision + streaming are opt-in only, never part of the default-all)
if (-not ($Backend -or $Gateway -or $Frontend -or $Provision -or $WithStreaming)) {
  $Backend = $true; $Gateway = $true; $Frontend = $true
}

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }

if (-not (Test-Path $Gcloud)) { throw "gcloud not found: $Gcloud  (use -Gcloud to set the path)" }

# Provisioning script runtime environment:
#  - GCLOUD_PATH: on Windows, Python subprocess can't find bare 'gcloud' (it's gcloud.cmd) -> WinError 2.
#    The scripts (_gcloud.py) use this value first to resolve the full gcloud.cmd path.
#  - $VenvPy: project venv python (has google-cloud-{bigquery,pubsub,...}). The system 'python' (other version)
#    may lack those libs, so provision_bigquery / _provision_infra would die with ImportError.
$env:GCLOUD_PATH = $Gcloud
$VenvPy = Join-Path $PSScriptRoot "apps\api\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  Write-Host "  WARN venv python not found ($VenvPy); falling back to 'python' on PATH" -ForegroundColor Yellow
  $VenvPy = "python"
}
# google-cloud Python clients (bigquery/pubsub) authenticate via ADC, NOT the gcloud CLI account.
# The user's ADC (application-default) lacked BigQuery perms -> 403 (datasets.get denied).
# Pin ADC to a project SA key that HAS BigQuery/PubSub access (this key is also used for the frontend deploy).
# gcloud-CLI scripts (grant_runtime_iam / setup_secrets / firestore fallback) are unaffected; they keep using the owner account.
if (Test-Path $SaKey) {
  $env:GOOGLE_APPLICATION_CREDENTIALS = $SaKey
} else {
  Write-Host "  WARN SA key not found ($SaKey); Python provisioning will use ambient ADC (may lack BigQuery perms)" -ForegroundColor Yellow
}

# (0) One-time GCP provisioning (idempotent). Guarded by -Provision so normal redeploys skip it.
#     Order matters: IAM first (so the runtime SA can read secrets & call every GCP path),
#     then secrets, then Firestore + BigQuery backing stores (DB exists before the app boots).
#     NOTE: Pub/Sub provisioning is intentionally NOT here - provision_pubsub.py deploys the
#     publisher Cloud Run Job, which needs the induspot-api image to already exist. It therefore
#     runs AFTER the backend deploy at step (a2), also gated by -Provision. Canonical one-time
#     activation is:  .\deploy.ps1 -Backend -Provision   (provision -> deploy -> pubsub, in order).
#     The Python scripts run from apps/api (they read .env / import app.core.config relative to that dir).
#     All scripts are idempotent (get-or-create + AlreadyExists guarded) and print *_OK on success.
if ($Provision) {
  Step "(0) GCP provisioning (-Provision): IAM -> secrets -> Firestore -> BigQuery (Pub/Sub runs post-deploy at a2)"
  Push-Location apps/api
  try {
    & $VenvPy scripts/grant_runtime_iam.py
    if ($LASTEXITCODE -ne 0) { throw "grant_runtime_iam.py failed (exit $LASTEXITCODE)" }
    & $VenvPy scripts/setup_secrets.py
    if ($LASTEXITCODE -ne 0) { throw "setup_secrets.py failed (exit $LASTEXITCODE)" }
    & $VenvPy scripts/provision_firestore.py
    if ($LASTEXITCODE -ne 0) { throw "provision_firestore.py failed (exit $LASTEXITCODE)" }
    # provision_bigquery / load_bq below authenticate as the SA key (GOOGLE_APPLICATION_CREDENTIALS).
    # The firebase-adminsdk SA has NO BigQuery permissions by default, so grant them here as the owner
    # gcloud account (idempotent). dataEditor = datasets/tables/models.create + tables.updateData;
    # jobUser = jobs.create (BQML training + data loads). SA email is derived from the key file.
    if (Test-Path $SaKey) {
      $SaEmail = (Get-Content $SaKey -Raw | ConvertFrom-Json).client_email
      foreach ($r in @("roles/bigquery.dataEditor", "roles/bigquery.jobUser")) {
        & $Gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$SaEmail" --role=$r --condition=None --format=none --quiet | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "  WARN could not grant $r to $SaEmail (continuing)" -ForegroundColor Yellow }
      }
      Ok "BigQuery roles ensured for provisioning SA ($SaEmail); waiting ~15s for IAM propagation"
      Start-Sleep -Seconds 15
    }
    # Load Supabase -> BigQuery history (BQML training data). Non-fatal: even on failure/0 rows, provisioning
    # continues; BQML can be (re)trained later once data accumulates (provision_bigquery skips the model step non-fatally).
    & $VenvPy scripts/load_bq.py
    if ($LASTEXITCODE -ne 0) { Write-Host "  WARN load_bq.py failed (exit $LASTEXITCODE) - retry BQML training after loading data" -ForegroundColor Yellow }
    & $VenvPy scripts/provision_bigquery.py
    if ($LASTEXITCODE -ne 0) { throw "provision_bigquery.py failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
  Ok "Provisioning complete (IAM_OK / SECRETS_OK / FIRESTORE_PROVISION_OK / BQML_OK or BQML_DEFERRED if no data yet)"
}

# (a) Cloud Run (backend)
if ($Backend) {
  # (a0) Re-seed facility embeddings (cuisine taxonomy + menu -> Firestore facility_embeddings) so the voice
  #      menu semantic search reflects the latest taxonomy (e.g. 삼겹당순대당->고깃집, 열정국밥->국밥, bars->술집).
  #      Runs BEFORE the deploy so the new revision's instances cache fresh vectors on first request.
  #      Non-fatal: on failure the voice filter keeps prior embeddings / Gemini match_ids fallback.
  #      Uses the gcloud USER ADC (has Vertex aiplatform.user + Firestore + Secret Manager), NOT the firebase
  #      SA key (which lacks aiplatform.user) -> temporarily clear GOOGLE_APPLICATION_CREDENTIALS for this step.
  if (-not $SkipReseed) {
    Step "(a0) Re-seed facility embeddings (taxonomy -> facility_embeddings) [skip with -SkipReseed]"
    $savedAdc = $env:GOOGLE_APPLICATION_CREDENTIALS
    Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
    Push-Location apps/api
    try {
      & $VenvPy scripts/seed_facility_embeddings.py
      if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARN seed_facility_embeddings.py failed (exit $LASTEXITCODE) - voice keeps prior embeddings / Gemini fallback" -ForegroundColor Yellow
      } else { Ok "facility_embeddings re-seeded" }
    } finally {
      Pop-Location
      if ($savedAdc) { $env:GOOGLE_APPLICATION_CREDENTIALS = $savedAdc }
    }
  }

  Step "(a) Cloud Run deploy ($Service) - merges AI/OIDC env + Secret Manager secrets (other env preserved)"
  # --update-env-vars (NOT --set-env-vars) merges these keys without wiping existing env:
  #   VERTEX_ENDPOINT_ID  -> flips congestion prediction from GCS-pickle fallback to a real Vertex online RPC
  #   GEMINI_ENABLED      -> turns on Vertex Gemini reasoning (fallback = template)
  #   EMBEDDING_ENABLED   -> turns on Vertex text-embedding semantic search for the voice menu filter
  #                          (reads facility_embeddings in Firestore; seed via apps/api/scripts/seed_facility_embeddings.py)
  #   PUBSUB_PUSH_*       -> turns on OIDC verification on /ingest/pubsub (empty would skip it)
  # --update-secrets sources the Supabase/JWT/GCS values from Secret Manager (audit: live revision lacked these).
  # If a prior revision set these 5 keys as PLAIN env vars, Cloud Run refuses to flip literal -> secret in one
  # update ("already set with a different type"). Strip any literal copies first (non-fatal: service may be new,
  # vars may already be secrets, or absent). The app still boots because config.load_gcp_secrets() reads them
  # from Secret Manager at startup (runtime SA has secretAccessor).
  & $Gcloud run services update $Service --region $Region --project $ProjectId --quiet `
      --remove-env-vars SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,JWT_SECRET,GCS_BUCKET_NAME
  if ($LASTEXITCODE -ne 0) { Write-Host "  (note) strip literal env vars skipped/no-op (new service, already secrets, or absent)" -ForegroundColor DarkGray }
  # --max-instances=8: 인프라 비용 가드. /voice/turn·/predict 는 무인증 공개라(데모 무세션) Vertex Gemini/임베딩을
  #   호출하므로, 외부에서 대량 호출 시 인스턴스 오토스케일(기본 100)로 비용이 폭주할 수 있다. 데모 트래픽엔
  #   8 인스턴스(×concurrency 80)면 충분하고, 최악의 abuse 비용 상한을 둔다. (입력 상한·타임아웃은 코드에 이미 존재.)
  & $Gcloud run deploy $Service --source apps/api --region $Region --project $ProjectId --quiet --max-instances=8 `
      --update-env-vars $ProdEnvVars `
      --update-secrets SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,JWT_SECRET=JWT_SECRET:latest,GCS_BUCKET_NAME=GCS_BUCKET_NAME:latest
  if ($LASTEXITCODE -ne 0) { throw "Cloud Run deploy failed (exit $LASTEXITCODE)" }
  Ok "Cloud Run deployed"

  # (a2) Pub/Sub provisioning (topic + push sub + run.invoker + publisher Job/Scheduler).
  #      Gated by -Provision (one-time setup), and runs AFTER the deploy above so the service image
  #      exists (publisher Cloud Run Job needs it) and the live URL is reachable for the push subscription.
  #      Routine '.\deploy.ps1 -Backend' redeploys skip this heavy, already-idempotent step.
  if ($Provision) {
    Step "(a2) Pub/Sub provisioning (topic + push sub + run.invoker + publisher Job/Scheduler)"
    Push-Location apps/api
    try {
      & $VenvPy scripts/provision_pubsub.py
      if ($LASTEXITCODE -ne 0) { throw "Pub/Sub provisioning failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
    Ok "Pub/Sub provisioned"
  }

  # (a3) BigQuery provisioning (idempotent: dataset + congestion_logs + BQML ARIMA_PLUS + lookup).
  #      Left as a documented MANUAL step (not auto-run): ARIMA_PLUS training takes minutes and must
  #      not block every backend deploy. Safe to re-run when the model needs (re)training.
  Step "(a3) BigQuery provision (run manually if model needs retrain): cd apps/api; poetry run python scripts/provision_bigquery.py  -> expect 'BQML_OK'"
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

# (d) Streaming processing (OPTIONAL, heavier) - separate managed Dataflow job, NOT part of the Cloud Run image.
#     apache-beam is deliberately excluded from apps/api/requirements.txt; this launches the persistent
#     streaming job 'induspot-congestion-windowing' via the dedicated beam venv. Re-run is idempotent
#     (the launcher uses a fixed job name; pass --update to roll out changes with no downtime).
if ($WithStreaming) {
  Step "(d) Dataflow streaming job (induspot-congestion-windowing) - optional, billed continuously"
  $BeamPython = Join-Path $PSScriptRoot "apps\api\.venv_beam\Scripts\python.exe"
  if (-not (Test-Path $BeamPython)) { throw "beam venv python not found: $BeamPython  (run: python -m venv apps/api/.venv_beam; .\apps\api\.venv_beam\Scripts\python -m pip install -r apps/api/dataflow/requirements.txt)" }
  # DataflowRunner submits the job via ADC. The provisioning step set GOOGLE_APPLICATION_CREDENTIALS to the
  # firebase SA key (which lacks dataflow.jobs.create); clear it so submission uses the gcloud user ADC
  # (editor: has dataflow.jobs.create + actAs on the compute worker SA). The job still RUNS as the compute SA.
  Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
  Push-Location (Join-Path $PSScriptRoot "apps\api")
  try {
    & $BeamPython "dataflow\launch_dataflow.py"
    if ($LASTEXITCODE -ne 0) { throw "Dataflow launch failed (exit $LASTEXITCODE) - if the job already exists, re-run the launcher with --update" }
  } finally { Pop-Location }
  Ok "Dataflow streaming job submitted (check the Dataflow console for RUNNING state)"
}

Write-Host "`n=== Deploy complete. Hard-refresh the browser (Ctrl+Shift+R) ===" -ForegroundColor Green
