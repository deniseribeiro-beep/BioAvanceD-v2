$ErrorActionPreference = 'Stop'

$directories = @(
  'backend/src/core/entities',
  'backend/src/core/use-cases',
  'backend/src/infrastructure/database/mongodb',
  'backend/src/infrastructure/database/neo4j',
  'backend/src/infrastructure/database/influxdb',
  'backend/src/infrastructure/middleware',
  'backend/src/interface/controllers',
  'backend/src/interface/routes',
  'backend/src/interface/dtos',
  'frontend/src/hooks',
  'frontend/src/services',
  'frontend/src/views'
)

$created = @()
$existing = @()

foreach ($relativePath in $directories) {
  $fullPath = Join-Path -Path $PSScriptRoot -ChildPath "..\$relativePath"
  if (Test-Path -Path $fullPath) {
    $existing += $relativePath
    continue
  }

  New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
  $created += $relativePath
}

Write-Host ''
Write-Host '=== Clean Architecture folder bootstrap ==='
Write-Host "Created: $($created.Count)"
Write-Host "Already existed: $($existing.Count)"

if ($created.Count -gt 0) {
  Write-Host ''
  Write-Host 'Created directories:'
  $created | ForEach-Object { Write-Host " - $_" }
}

if ($existing.Count -gt 0) {
  Write-Host ''
  Write-Host 'Already existing directories:'
  $existing | ForEach-Object { Write-Host " - $_" }
}

Write-Host ''
Write-Host 'Done.'