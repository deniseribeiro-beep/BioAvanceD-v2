# Builds a Zenodo-ready ZIP (local only; not committed).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pack = Join-Path $root "docs\data\zenodo-pack\terminologias-consolidadas-v1"
$mdb = Join-Path $root "docs\data\markerdb\2024-09-12"
$staging = Join-Path $env:TEMP "bioavanced-zenodo-terminologias-v1"
$zip = Join-Path $root "docs\data\zenodo-pack\BioAvanceD-terminologias-consolidadas-v1.zip"

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path "$staging\markerdb-binaries" | Out-Null
Copy-Item -Recurse "$pack\*" $staging -Force
Copy-Item "$mdb\*.tsv","$mdb\*.xml" "$staging\markerdb-binaries\" -Force

if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path "$staging\*" -DestinationPath $zip -Force
Write-Host "WROTE $zip size=$((Get-Item $zip).Length)"
