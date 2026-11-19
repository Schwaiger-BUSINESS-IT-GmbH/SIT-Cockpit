<#
.SYNOPSIS
  SIT-Cockpit direkt vom eigenen PC nach Azure deployen (ohne GitHub Actions).
  Voraussetzung: Node.js, Azure CLI, az login.

.BEISPIEL
  .\infra\3-deploy-manual.ps1
#>
param(
  [string] $AppName       = 'sit-cockpit-schwaiger',
  [string] $ResourceGroup = 'rg-sit-time'
)
$ErrorActionPreference = 'Continue'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  Step "Paket bauen (Version $version)"
  $build = Join-Path $env:TEMP 'sit-cockpit-build'
  if (Test-Path $build) { Remove-Item $build -Recurse -Force }
  New-Item -ItemType Directory $build | Out-Null
  foreach ($item in @('server', 'public', 'scripts', 'config', 'package.json', 'package-lock.json')) {
    Copy-Item $item -Destination $build -Recurse
  }
  Push-Location $build
  & npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci fehlgeschlagen' }
  $zip = Join-Path $env:TEMP 'sit-cockpit-release.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  # tar (bsdtar, ab Windows 10) erzeugt ZIPs mit "/" als Pfadtrenner - wichtig fuer Linux
  & tar.exe -a -c -f $zip *
  if ($LASTEXITCODE -ne 0) { throw 'ZIP erstellen fehlgeschlagen' }
  Pop-Location

  Step "Nach Azure hochladen ($AppName)"
  & az webapp deploy -g $ResourceGroup -n $AppName --src-path $zip --type zip --restart true
  if ($LASTEXITCODE -ne 0) { throw 'az webapp deploy fehlgeschlagen' }

  Step 'Health-Check'
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-RestMethod "https://$AppName.azurewebsites.net/healthz" -TimeoutSec 10
      if ($r.version -eq $version) { Write-Host "OK - Version $($r.version) laeuft." -ForegroundColor Green; break }
      Write-Host "laeuft noch Version $($r.version), warte..."
    } catch { Write-Host 'warte auf Start...' }
    Start-Sleep -Seconds 5
  }
} finally { Pop-Location }
