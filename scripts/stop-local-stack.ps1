param(
  [string]$EnvFile = ".env.docker",
  [string]$ComposeFile = "docker-compose.yml",
  [switch]$RemoveVolumes,
  [switch]$RemoveImages,
  [switch]$RemoveOrphans
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatório não encontrado: $Name"
  }
}

Write-Step "Validando pré-requisitos"
Ensure-Command -Name 'docker'

if (-not (Test-Path -LiteralPath $ComposeFile)) {
  throw "Compose file não encontrado: $ComposeFile"
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-Host "Arquivo de ambiente não encontrado: $EnvFile. Continuando mesmo assim..." -ForegroundColor Yellow
}

Write-Step "Parando e removendo containers da stack"
$composeArgs = @('compose')
if (Test-Path -LiteralPath $EnvFile) {
  $composeArgs += @('--env-file', $EnvFile)
}
$composeArgs += @('-f', $ComposeFile, 'down')

if ($RemoveVolumes) {
  $composeArgs += '--volumes'
}

if ($RemoveImages) {
  $composeArgs += @('--rmi', 'local')
}

if ($RemoveOrphans) {
  $composeArgs += '--remove-orphans'
}

& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao derrubar stack com Docker Compose."
}

Write-Host "`nStack local parada com sucesso." -ForegroundColor Green
