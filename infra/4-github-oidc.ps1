<#
.SYNOPSIS
  GitHub-OIDC fuer das Deployment nach einem Repo-Umzug (z.B. in die Organisation) neu verknuepfen.

.HINTERGRUND
  Azure prueft beim Login den "subject claim" aus GitHub. Nach einem Umzug aendert sich
  Owner bzw. Owner-ID, daher passt der alte Federated Credential nicht mehr (AADSTS700213).
  Den genauen Subject siehst du im fehlgeschlagenen Actions-Log unter "subject claim".

.BEISPIEL
  .\infra\4-github-oidc.ps1 -Subject 'repo:Schwaiger-BUSINESS-IT-GmbH@336510769/SIT-Cockpit@1394593307:ref:refs/heads/main'
#>
param(
  [Parameter(Mandatory)] [string] $Subject,
  [string] $AppName = 'sit-cockpit-schwaiger',
  [string] $Name    = 'github-main'
)

$ErrorActionPreference = 'Continue'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function AzOk { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') fehlgeschlagen" }; $out }

Step 'Deploy-App suchen'
$apps = @(AzOk ad app list --display-name "SIT-Cockpit GitHub Deploy ($AppName)" -o json | ConvertFrom-Json)
if (-not $apps.Count) { throw "App 'SIT-Cockpit GitHub Deploy ($AppName)' nicht gefunden" }
$appId = $apps[0].appId
Write-Host "App-ID: $appId"

Step 'Vorhandene Federated Credentials'
$feds = @(AzOk ad app federated-credential list --id $appId -o json | ConvertFrom-Json)
foreach ($f in $feds) { Write-Host ("  {0,-22} {1}" -f $f.name, $f.subject) }

if ($feds | Where-Object { $_.subject -eq $Subject }) {
  Write-Host "`nSubject ist bereits eingetragen - nichts zu tun." -ForegroundColor Green
  return
}

# Name eindeutig machen, falls schon vergeben
$credName = $Name
$i = 2
while ($feds | Where-Object { $_.name -eq $credName }) { $credName = "$Name-$i"; $i++ }

Step "Federated Credential '$credName' anlegen"
$fedFile = Join-Path $env:TEMP 'sit-cockpit-fed.json'
@{
  name      = $credName
  issuer    = 'https://token.actions.githubusercontent.com'
  subject   = $Subject
  audiences = @('api://AzureADTokenExchange')
} | ConvertTo-Json | Set-Content -Path $fedFile -Encoding ASCII
AzOk ad app federated-credential create --id $appId --parameters "@$fedFile" -o none
Remove-Item $fedFile -ErrorAction SilentlyContinue

Step 'Fertig'
Write-Host 'In GitHub unter Actions den fehlgeschlagenen Lauf mit "Re-run jobs" neu starten.'
Write-Host 'Den alten Eintrag (altes Repo) kannst du spaeter loeschen:'
Write-Host "  az ad app federated-credential delete --id $appId --federated-credential-id <name>"
