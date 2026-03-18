param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [string]$HealthPath = '/api/health'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  throw 'curl.exe não encontrado no ambiente. Instale/ative o curl antes da validação.'
}

function Invoke-CurlProbe {
  param(
    [string]$Url,
    [string[]]$Arguments,
    [switch]$ExpectFailure
  )

  $allArgs = @('--silent', '--show-error', '--output', 'NUL', '--max-time', '20') + $Arguments + @($Url)

  & curl.exe @allArgs
  $exitCode = $LASTEXITCODE

  if ($ExpectFailure) {
    return ($exitCode -ne 0)
  }

  return ($exitCode -eq 0)
}

$normalizedBase = $BaseUrl.TrimEnd('/')
$targetUrl = "$normalizedBase$HealthPath"

Write-Host "[TLS-VALIDATION] Alvo: $targetUrl"

$tls13Ok = Invoke-CurlProbe -Url $targetUrl -Arguments @('--tlsv1.3')
if ($tls13Ok) {
  Write-Host '[PASS] TLS 1.3 aceito pelo endpoint.'
} else {
  Write-Host '[FAIL] TLS 1.3 não negociou com sucesso.'
}

$tls12Rejected = Invoke-CurlProbe -Url $targetUrl -Arguments @('--tlsv1.2', '--tls-max', '1.2') -ExpectFailure
if ($tls12Rejected) {
  Write-Host '[PASS] TLS 1.2 recusado (comportamento esperado para profile TLSv1.3-only).'
} else {
  Write-Host '[FAIL] TLS 1.2 ainda foi aceito. O endpoint não está estritamente TLS 1.3-only.'
}

if ($tls13Ok -and $tls12Rejected) {
  Write-Host '[RESULT] Validação de cutover TLS concluída com sucesso.'
  exit 0
}

Write-Host '[RESULT] Validação de cutover TLS falhou. Verifique configuração e reinício do Nginx.'
exit 1