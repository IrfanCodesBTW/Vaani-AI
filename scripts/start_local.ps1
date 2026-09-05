<#
.SYNOPSIS
    Vaani AI Voice Platform - Local Docker Deployment
    Runs Dograh + Rumik TTS overlay + Vaani AI Console dashboard locally.

.DESCRIPTION
    This script:
      1. Checks prerequisites (Docker, Node.js)
      2. Builds the Rumik TTS overlay image on top of dograh-api
      3. Starts Dograh (postgres, redis, minio, api, ui) with a Cloudflare tunnel
         so Vobiz webhooks can reach your local instance
      4. Waits for the API to be healthy
      5. Installs and starts the Vaani AI Console dashboard on port 8787

    No SSH. No VPS. Everything runs locally in Docker.
#>

$ErrorActionPreference = 'Stop'
$RootDir   = $PSScriptRoot
$DograhDir = Join-Path $RootDir 'dograh-local'
$RumikDir  = Join-Path $RootDir 'rumik-overlay-local'
$DashDir   = Join-Path $RootDir 'dashboard'
$EnvFile   = Join-Path $RootDir '.env'

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  ok  $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  warn  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  FAIL  $msg" -ForegroundColor Red; exit 1 }

function Get-EnvVal {
    param([string]$Key, [string]$File = $EnvFile)
    if (-not (Test-Path $File)) { return $null }
    foreach ($line in [System.IO.File]::ReadLines($File)) {
        if ($line -match "^$Key=(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 0: Check prerequisites
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Checking prerequisites"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail "Docker is not installed or not in PATH. Install Docker Desktop: https://www.docker.com/products/docker-desktop"
}

# Auto-start Docker Desktop if daemon is not reachable
$dockerRunning = $false
try { docker ps 2>&1 | Out-Null; $dockerRunning = ($LASTEXITCODE -eq 0) } catch { }

if (-not $dockerRunning) {
    Write-Host "  Docker daemon is not running. Starting Docker Desktop..." -ForegroundColor Yellow
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
        Write-Host "  Waiting for Docker Desktop to start (up to 2 minutes)..." -ForegroundColor Yellow
        $started = $false
        for ($w = 1; $w -le 24; $w++) {
            Start-Sleep -Seconds 5
            Write-Host "  Waiting... ($($w * 5)s / 120s)"
            try { docker ps 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $started = $true; break } } catch { }
        }
        if (-not $started) { Write-Fail "Docker Desktop did not start in time. Please start it manually and re-run this script." }
    } else {
        Write-Fail "Docker Desktop not found at $dockerExe. Please start Docker Desktop manually and re-run."
    }
}
Write-OK "Docker is running"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warn "Node.js not found. Dashboard will be skipped. Install from https://nodejs.org"
    $HasNode = $false
} else {
    Write-OK "Node.js found: $(node --version)"
    $HasNode = $true
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 1: Build Rumik TTS overlay image
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Building Rumik TTS overlay image (dograh-api + pipecat-rumik)"
Write-Host "  This layers pipecat-rumik onto the official dograh-api image."
Write-Host "  Using --no-deps to avoid overwriting Dograh's vendored pipecat fork."

docker build -f (Join-Path $RumikDir 'Dockerfile') -t dograh-api-rumik:local $RootDir
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to build Rumik overlay image." }
Write-OK "Image 'dograh-api-rumik:local' built"

# ──────────────────────────────────────────────────────────────────────────────
# Step 2: Build a fresh .env.run for Dograh (avoids IDE file locks on .env)
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Preparing Dograh configuration"

# Write to a separate .env.run so we never touch the IDE-locked .env
$DograhRunEnv = Join-Path $DograhDir '.env.run'

# Generate a JWT secret
$bytes = [byte[]]::new(32)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes); $rng.Dispose()
$jwtSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
Write-OK "Generated OSS_JWT_SECRET"

# Use FIXED passwords so they stay consistent across runs (volume re-use)
$pgPassword = "dograhlocal123"
$rdPassword = "dograhredis123"

$groqKey    = Get-EnvVal 'GROQ_API_KEY'
$dgKey      = Get-EnvVal 'DEEPGRAM_API_KEY'
$rumikKey   = Get-EnvVal 'RUMIK_API_KEY'

$runEnvLines = @(
    "OSS_JWT_SECRET=$jwtSecret",
    "POSTGRES_PASSWORD=$pgPassword",
    "REDIS_PASSWORD=$rdPassword",
    "GROQ_API_KEY=$groqKey",
    "DEEPGRAM_API_KEY=$dgKey",
    "RUMIK_API_KEY=$rumikKey",
    "ENVIRONMENT=local",
    "FASTAPI_WORKERS=1",
    "ENABLE_TELEMETRY=false"
)
$runEnvLines | Set-Content -Path $DograhRunEnv -Encoding UTF8 -Force
Write-OK "Dograh runtime config written to dograh-local\.env.run"

if (-not [string]::IsNullOrWhiteSpace($groqKey))   { Write-OK "Synced GROQ_API_KEY" }   else { Write-Warn "GROQ_API_KEY not set in .env" }
if (-not [string]::IsNullOrWhiteSpace($dgKey))     { Write-OK "Synced DEEPGRAM_API_KEY" } else { Write-Warn "DEEPGRAM_API_KEY not set in .env" }
if (-not [string]::IsNullOrWhiteSpace($rumikKey))  { Write-OK "Synced RUMIK_API_KEY" }  else { Write-Warn "RUMIK_API_KEY not set in .env" }

# ──────────────────────────────────────────────────────────────────────────────
# Step 3: Create Compose override to use Rumik image
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Configuring Rumik overlay"
$overridePath = Join-Path $DograhDir 'docker-compose.rumik-override.yaml'
@(
    "services:",
    "  api:",
    "    image: dograh-api-rumik:local"
) | Set-Content -Path $overridePath -Encoding UTF8 -Force
Write-OK "Compose override written: docker-compose.rumik-override.yaml"

# ──────────────────────────────────────────────────────────────────────────────
# Step 4: Start Dograh with tunnel profile
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Starting Dograh stack (postgres, redis, minio, api, ui, cloudflared)"
Write-Host "  Profile: tunnel  (enables Cloudflare tunnel for public webhook URL)"
Write-Host "  API image: dograh-api-rumik:local  (Rumik TTS included)"
Write-Host ""

Push-Location $DograhDir

# Tear down any existing stack first so volumes are recreated with correct passwords
Write-Host "  Removing stale containers and volumes (clean start)..." -ForegroundColor Yellow
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker compose `
    -f docker-compose.yaml `
    -f docker-compose.rumik-override.yaml `
    --env-file .env.run `
    --profile tunnel `
    down --volumes 2>&1 | Out-Null
$ErrorActionPreference = $prevEAP
Write-OK "Clean slate ready"
Write-Host ""
Write-Host "  Ports:"
Write-Host "    Dograh API   -> http://localhost:8000"
Write-Host "    Dograh UI    -> http://localhost:3010"
Write-Host "    MinIO API    -> http://localhost:9000"
Write-Host "    MinIO UI     -> http://localhost:9001"
Write-Host "    CF Metrics   -> http://localhost:2000"
Write-Host ""

Push-Location $DograhDir
docker compose `
    -f docker-compose.yaml `
    -f docker-compose.rumik-override.yaml `
    --env-file .env.run `
    --profile tunnel `
    up -d --pull missing
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Fail "docker compose up failed. Check: docker compose -f dograh-local/docker-compose.yaml logs"
}
Pop-Location
Write-OK "Containers started"

# ──────────────────────────────────────────────────────────────────────────────
# Step 5: Wait for Dograh API health
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Waiting for Dograh API to be healthy (up to 3 minutes)"
$healthy = $false
for ($i = 1; $i -le 36; $i++) {
    Start-Sleep -Seconds 5
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:8000/api/v1/health' -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Write-Host "  Waiting... ($($i * 5)s / 180s)"
}
if ($healthy) { Write-OK "Dograh API is healthy" }
else { Write-Warn "API not yet healthy - containers may still be initializing. Check: docker compose -f dograh-local/docker-compose.yaml logs api" }

# ──────────────────────────────────────────────────────────────────────────────
# Step 6: Get Cloudflare tunnel URL
# ──────────────────────────────────────────────────────────────────────────────
Write-Step "Retrieving Cloudflare tunnel public URL"
$tunnelUrl = $null
for ($i = 1; $i -le 12; $i++) {
    Start-Sleep -Seconds 5
    try {
        $metrics = Invoke-RestMethod -Uri 'http://localhost:2000/metrics' -TimeoutSec 4 -ErrorAction Stop
        $match = [regex]::Match($metrics, 'userHostname="(https://[^"]+trycloudflare\.com[^"]*)"')
        if ($match.Success) { $tunnelUrl = $match.Groups[1].Value; break }
    } catch { }
    Write-Host "  Waiting for tunnel URL... ($($i * 5)s)"
}

if ($tunnelUrl) {
    Write-OK "Tunnel URL: $tunnelUrl"
    # Update root .env
    $envLines = Get-Content $EnvFile
    $updated = $false
    $newLines = $envLines | ForEach-Object {
        if ($_ -match '^DOGRAH_BASE_URL=') { $updated = $true; "DOGRAH_BASE_URL=$tunnelUrl" } else { $_ }
    }
    if (-not $updated) { $newLines += "DOGRAH_BASE_URL=$tunnelUrl" }
    $newLines | Set-Content $EnvFile -Encoding UTF8
    Write-OK "DOGRAH_BASE_URL updated in root .env"
} else {
    Write-Warn "Could not auto-detect tunnel URL."
    Write-Warn "Check: docker logs cloudflared-tunnel"
    $tunnelUrl = "http://localhost:8000"
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 7: Install and start the Vaani AI Console Dashboard
# ──────────────────────────────────────────────────────────────────────────────
if ($HasNode) {
    Write-Step "Setting up Vaani AI Console Dashboard (port 8787)"
    Push-Location $DashDir

    $dashPort = if (Get-EnvVal 'DASHBOARD_PORT') { Get-EnvVal 'DASHBOARD_PORT' } else { '8787' }
    $dashEnvLines = @(
        "DOGRAH_BASE_URL=$tunnelUrl",
        "DOGRAH_API_KEY=$(Get-EnvVal 'DOGRAH_API_KEY')",
        "DOGRAH_WORKFLOW_ID=$(Get-EnvVal 'DOGRAH_WORKFLOW_ID')",
        "DOGRAH_TELEPHONY_CONFIG_ID=$(Get-EnvVal 'DOGRAH_TELEPHONY_CONFIG_ID')",
        "DOGRAH_PHONE_NUMBER_ID=$(Get-EnvVal 'DOGRAH_PHONE_NUMBER_ID')",
        "DEEPGRAM_API_KEY=$(Get-EnvVal 'DEEPGRAM_API_KEY')",
        "GROQ_API_KEY=$(Get-EnvVal 'GROQ_API_KEY')",
        "RUMIK_API_KEY=$(Get-EnvVal 'RUMIK_API_KEY')",
        "RUMIK_MODEL=$(Get-EnvVal 'RUMIK_MODEL')",
        "RUMIK_VOICE=$(Get-EnvVal 'RUMIK_VOICE')",
        "VOBIZ_AUTH_ID=$(Get-EnvVal 'VOBIZ_AUTH_ID')",
        "VOBIZ_AUTH_TOKEN=$(Get-EnvVal 'VOBIZ_AUTH_TOKEN')",
        "VOBIZ_NUMBER=$(Get-EnvVal 'VOBIZ_NUMBER')",
        "GEMINI_API_KEY=$(Get-EnvVal 'GEMINI_API_KEY')",
        "GEMINI_MODEL=$(Get-EnvVal 'GEMINI_MODEL')",
        "DASHBOARD_PORT=$dashPort"
    )
    $dashEnvLines | Set-Content -Path (Join-Path $DashDir '.env') -Encoding UTF8 -Force
    Write-OK "Dashboard .env written"

    npm install --silent 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-OK "Dependencies installed" }
    else { Write-Warn "npm install had issues - try: cd dashboard && npm install" }

    npm run build 2>&1 | Out-Null
    Write-OK "Assets built"

    Pop-Location
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $DashDir -PassThru | Out-Null
    Start-Sleep -Seconds 2
    Write-OK "Dashboard started at http://localhost:$dashPort"
}

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Vaani AI Voice Platform is running locally!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Service URLs:" -ForegroundColor White
Write-Host "    Dograh UI Console  ->  http://localhost:3010" -ForegroundColor Cyan
Write-Host "    Dograh API         ->  http://localhost:8000" -ForegroundColor Cyan
Write-Host "    MinIO Console      ->  http://localhost:9001  (minioadmin/minioadmin)" -ForegroundColor Cyan
if ($HasNode) {
Write-Host "    Vaani AI Dashboard   ->  http://localhost:8787" -ForegroundColor Cyan
}
if ($tunnelUrl -and $tunnelUrl -ne "http://localhost:8000") {
Write-Host "    Public Tunnel URL  ->  $tunnelUrl" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Open http://localhost:3010 and SIGN UP"
Write-Host "       (email/password from .env DOGRAH_EMAIL/DOGRAH_PASSWORD)"
Write-Host "    2. Go to Settings -> API Keys -> create an org key"
Write-Host "       and set DOGRAH_API_KEY in your .env"
Write-Host "    3. Go to Settings -> Telephony -> add Vobiz credentials"
Write-Host "    4. Import the Ria workflow: Dograh UI -> Workflows -> Import JSON"
Write-Host "       File: workflows/ria-receptionist.json"
Write-Host "    5. Open http://localhost:8787 for the Vaani AI Console"
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor White
Write-Host "    View all logs:   docker compose -f dograh-local/docker-compose.yaml logs -f"
Write-Host "    View API logs:   docker compose -f dograh-local/docker-compose.yaml logs -f api"
Write-Host "    Tunnel URL:      docker logs cloudflared-tunnel 2>&1 | Select-String 'trycloudflare'"
Write-Host "    Stop stack:      docker compose -f dograh-local/docker-compose.yaml --profile tunnel down"
Write-Host ""
