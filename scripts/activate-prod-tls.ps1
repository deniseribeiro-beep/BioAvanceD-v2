$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'infra\nginx\npm\custom\http_top.prod.conf'
$target = Join-Path $root 'infra\nginx\npm\custom\http_top.conf'

if (-not (Test-Path $source)) {
  throw "Arquivo de configuração de produção não encontrado: $source"
}

Copy-Item -Path $source -Destination $target -Force
Write-Host 'Perfil TLS de produção ativado (TLSv1.3-only) em infra/nginx/npm/custom/http_top.conf'
Write-Host 'Reinicie o serviço nginx (Nginx Proxy Manager) para aplicar as mudanças.'
