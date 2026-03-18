$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'infra\nginx\npm\custom\http_top.conf'

@'
ssl_protocols TLSv1.2 TLSv1.3;
'@ | Set-Content -Path $target -Encoding UTF8

Write-Host 'Perfil TLS de desenvolvimento ativado (TLSv1.2 + TLSv1.3) em infra/nginx/npm/custom/http_top.conf'
Write-Host 'Reinicie o serviço nginx (Nginx Proxy Manager) para aplicar as mudanças.'
