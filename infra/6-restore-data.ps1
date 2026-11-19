<#
.SYNOPSIS
  Datenordner (/home/data) einer App aus der naechtlichen Sicherung wiederherstellen.

.BESCHREIBUNG
  Ohne -Apply wird nur angezeigt, welche Sicherungen es gibt und was die gewaehlte
  enthaelt (nichts wird veraendert). Mit -Apply wird der aktuelle Datenordner VORHER
  zusaetzlich lokal gesichert, dann die Sicherung zurueckgespielt und die App neu gestartet.

.BEISPIEL
  .\infra\6-restore-data.ps1 -App sit-cockpit-schwaiger                  # Sicherungen auflisten
  .\infra\6-restore-data.ps1 -App sit-cockpit-schwaiger -Backup 2026-11-20_0130.zip
  .\infra\6-restore-data.ps1 -App sit-cockpit-schwaiger -Backup 2026-11-20_0130.zip -Apply
  .\infra\6-restore-data.ps1 -App sit-cockpit-schwaiger -Backup 2026-11-20_0130.zip -OnlyFile customer-map.json -Apply
#>
param(
  [Parameter(Mandatory)] [string] $App,
  [string] $Backup = '',
  [string] $OnlyFile = '',                 # nur eine einzelne Datei zurueckspielen
  [switch] $Apply,
  [string] $ResourceGroup  = 'rg-sit-time',
  [string] $StorageAccount = 'stsitbackupschwaiger',
  [string] $Container      = 'app-data-backups'
)
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Token { az account get-access-token --resource 'https://management.core.windows.net/' --query accessToken -o tsv }

Step "Sicherungen von $App"
$list = az storage blob list --auth-mode login --account-name $StorageAccount -c $Container --prefix "$App/" --query "[].{name:name, size:properties.contentLength, date:properties.lastModified}" -o json | ConvertFrom-Json
if (-not $list) { throw 'Keine Sicherungen gefunden.' }
$list | Sort-Object date -Descending | Select-Object -First 15 | ForEach-Object { '  {0}  {1,8:N0} Bytes' -f ($_.name -replace "^$App/", ''), $_.size }
if (-not $Backup) { Write-Host "`nMit -Backup <datei> eine Sicherung waehlen." ; return }

$tmp = Join-Path $env:TEMP "restore-$App-$([guid]::NewGuid().ToString('N').Substring(0,6))"
New-Item -ItemType Directory $tmp | Out-Null
$zip = Join-Path $tmp $Backup
az storage blob download --auth-mode login --account-name $StorageAccount -c $Container -n "$App/$Backup" -f $zip -o none --only-show-errors
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
Step "Inhalt von $Backup"
$z.Entries | Where-Object { $_.Name } | ForEach-Object { '  {0,-40} {1,8:N0} Bytes' -f $_.FullName, $_.Length }
$z.Dispose()
if (-not $Apply) { Write-Host "`nNur angezeigt. Zum Zurueckspielen -Apply anhaengen." -ForegroundColor Yellow; return }

$scm = "https://$App.scm.azurewebsites.net/api"
$h = @{ Authorization = "Bearer $(Token)" }
Step 'Aktuellen Stand vorher lokal sichern'
$before = Join-Path $tmp "vorher-$App.zip"
Invoke-WebRequest -Uri "$scm/zip/data/" -Headers $h -OutFile $before
Write-Host "  $before"

if ($OnlyFile) {
  Step "Nur $OnlyFile zurueckspielen"
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  $entry = $z.Entries | Where-Object { $_.FullName -eq $OnlyFile } | Select-Object -First 1
  if (-not $entry) { $z.Dispose(); throw "$OnlyFile ist nicht in der Sicherung." }
  $out = Join-Path $tmp ($OnlyFile -replace '[\\/]', '_')
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true); $z.Dispose()
  Invoke-WebRequest -Method Put -Uri "$scm/vfs/data/$OnlyFile" -Headers ($h + @{ 'If-Match' = '*' }) -InFile $out -ContentType 'application/octet-stream' | Out-Null
} else {
  Step 'Gesamten Datenordner zurueckspielen'
  Invoke-WebRequest -Method Put -Uri "$scm/zip/data/" -Headers $h -InFile $zip -ContentType 'application/zip' | Out-Null
}

Step 'App neu starten'
az webapp restart -g $ResourceGroup -n $App -o none
Write-Host "Fertig. Vorheriger Stand liegt unter $before" -ForegroundColor Green
