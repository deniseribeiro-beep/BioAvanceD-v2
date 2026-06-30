param(
    [string]$EnvFile = ".env.docker",
    [string]$ComposeFile = "docker-compose.yml"
)

$ErrorActionPreference = "Stop"

Write-Host "Stopping Docker stack ($ComposeFile, env file: $EnvFile)..."
docker compose --env-file $EnvFile -f $ComposeFile down
exit $LASTEXITCODE
