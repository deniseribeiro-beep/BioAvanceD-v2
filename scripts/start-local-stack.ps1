param(
  [string]$EnvFile = ".env.docker",
  [string]$ComposeFile = "docker-compose.yml",
  [switch]$SkipBuild,
  [switch]$SkipMigration,
  [switch]$DropTarget,
  [string]$Collections,
  [int]$BatchSize = 0,
  [int]$MaxMigrationRetries = 8,
  [int]$RetryDelaySeconds = 5
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Import-EnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Arquivo de ambiente não encontrado: $Path"
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      return
    }

    $separatorIndex = $line.IndexOf('=')
    if ($separatorIndex -lt 1) {
      return
    }

    $key = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$key" -Value $value
  }
}

function Ensure-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatório não encontrado: $Name"
  }
}

function Invoke-Migration {
  param(
    [switch]$DropTarget,
    [string]$Collections,
    [int]$BatchSize,
    [int]$MaxRetries,
    [int]$RetryDelay
  )

  if (-not $env:MONGO_SOURCE_URI -or -not $env:MONGO_SOURCE_DB) {
    throw "Para migrar dados, defina MONGO_SOURCE_URI e MONGO_SOURCE_DB no arquivo de ambiente (ou use -SkipMigration)."
  }

  $npmArgs = @('--prefix', 'backend', 'run', 'migrate:mongo:online-local', '--')

  if ($DropTarget) {
    $npmArgs += '--drop-target'
  }

  if ($Collections) {
    $npmArgs += "--collections=$Collections"
  }

  if ($BatchSize -gt 0) {
    $npmArgs += "--batch-size=$BatchSize"
  }

  for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
    Write-Host "Tentativa de migração $attempt/$MaxRetries..." -ForegroundColor Yellow
    & npm @npmArgs

    if ($LASTEXITCODE -eq 0) {
      Write-Host 'Migração finalizada com sucesso.' -ForegroundColor Green
      return
    }

    if ($attempt -lt $MaxRetries) {
      Write-Host "Falha na migração; aguardando ${RetryDelay}s para nova tentativa..." -ForegroundColor Yellow
      Start-Sleep -Seconds $RetryDelay
    }
  }

  throw "Migração falhou após $MaxRetries tentativas."
}

Write-Step "Validando pré-requisitos"
Ensure-Command -Name 'docker'
Ensure-Command -Name 'npm'

if (-not (Test-Path -LiteralPath $ComposeFile)) {
  throw "Compose file não encontrado: $ComposeFile"
}

Write-Step "Carregando variáveis de ambiente de $EnvFile"
Import-EnvFile -Path $EnvFile

Write-Step "Subindo stack Docker"
$composeArgs = @('compose', '--env-file', $EnvFile, '-f', $ComposeFile, 'up', '-d')
if (-not $SkipBuild) {
  $composeArgs += '--build'
}

& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao subir serviços com Docker Compose."
}

if ($SkipMigration) {
  Write-Host "Migração ignorada por parâmetro (-SkipMigration)." -ForegroundColor Yellow
  exit 0
}

Write-Step "Executando migração MongoDB online -> local"
Invoke-Migration -DropTarget:$DropTarget -Collections $Collections -BatchSize $BatchSize -MaxRetries $MaxMigrationRetries -RetryDelay $RetryDelaySeconds

Write-Host "`nStack pronta e migração concluída." -ForegroundColor Green
