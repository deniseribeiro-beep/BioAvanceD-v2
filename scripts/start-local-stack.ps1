param(
    [string]$EnvFile = ".env.docker",
    [string]$ComposeFile = "docker-compose.yml",
    [switch]$SkipMigration
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
    Write-Error "Env file '$EnvFile' not found. Copy .env.docker.example to $EnvFile and fill in real values first."
    exit 1
}

Write-Host "Starting Docker stack ($ComposeFile, env file: $EnvFile)..."
docker compose --env-file $EnvFile -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose up failed."
    exit $LASTEXITCODE
}

Write-Host "Waiting for backend health endpoint (http://localhost:3000/api/health)..."
$maxAttempts = 30
$attempt = 0
$healthy = $false
while ($attempt -lt $maxAttempts) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 3
        if ($response.status -eq "OK") {
            $healthy = $true
            break
        }
    } catch {
        # backend not ready yet, keep polling
    }
    $attempt++
    Start-Sleep -Seconds 2
}

if (-not $healthy) {
    Write-Error "Backend did not become healthy after $($maxAttempts * 2) seconds. Check 'docker compose logs backend'."
    exit 1
}

Write-Host "Backend is healthy."

if (-not $SkipMigration) {
    Write-Host "Running seed/migration (npm run seed)..."
    npm run seed
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Seed/migration failed."
        exit $LASTEXITCODE
    }
}

Write-Host "Local stack is up. Frontend: http://localhost:5173  Backend: http://localhost:3000"
