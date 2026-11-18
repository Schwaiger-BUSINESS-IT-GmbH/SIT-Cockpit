<#
.SYNOPSIS
  Eigene Domain (z.B. cockpit.schwaiger-it.at) mit kostenlosem Azure-Zertifikat anbinden.

.ABLAUF
  1. Ohne -Bind ausfuehren -> zeigt die zwei DNS-Eintraege, die du beim DNS-Provider anlegst.
  2. Warten bis DNS aktiv ist (nslookup cockpit.schwaiger-it.at), dann mit -Bind erneut ausfuehren.

.BEISPIEL
  .\infra\2-custom-domain.ps1 -Hostname cockpit.schwaiger-it.at
  .\infra\2-custom-domain.ps1 -Hostname cockpit.schwaiger-it.at -Bind
#>
param(
  [Parameter(Mandatory)] [string] $Hostname,
  [string] $AppName       = 'sit-cockpit-schwaiger',
  [string] $ResourceGroup = 'rg-sit-cockpit',
  [switch] $Bind
)

$ErrorActionPreference = 'Continue'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function AzOk { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') fehlgeschlagen" }; $out }

$defaultHost = "$AppName.azurewebsites.net"
$sub = $Hostname.Split('.')[0]
$verificationId = AzOk webapp show -g $ResourceGroup -n $AppName --query customDomainVerificationId -o tsv

if (-not $Bind) {
  Write-Host "`nBitte beim DNS-Provider der Domain anlegen:" -ForegroundColor Yellow
  Write-Host ("  {0,-7} {1,-22} {2}" -f 'Typ', 'Name', 'Wert')
  Write-Host ("  {0,-7} {1,-22} {2}" -f 'CNAME', $sub, $defaultHost)
  Write-Host ("  {0,-7} {1,-22} {2}" -f 'TXT', "asuid.$sub", $verificationId)
  Write-Host "`nDanach (wenn 'nslookup $Hostname' auf $defaultHost zeigt):"
  Write-Host "  .\infra\2-custom-domain.ps1 -Hostname $Hostname -Bind"
  return
}

Step "Hostname $Hostname hinzufuegen"
$hostNames = @(AzOk webapp show -g $ResourceGroup -n $AppName --query hostNames -o json | ConvertFrom-Json)
if ($hostNames -contains $Hostname) {
  Write-Host 'Hostname ist bereits eingetragen.'
} else {
  AzOk webapp config hostname add -g $ResourceGroup --webapp-name $AppName --hostname $Hostname -o none
}

Step 'Redirect-URI der Entra-App ergaenzen'
$authAppId = AzOk ad app list --display-name "SIT-Cockpit ($AppName)" --query '[0].appId' -o tsv
if ($authAppId) {
  AzOk ad app update --id $authAppId --web-redirect-uris `
    "https://$defaultHost/.auth/login/aad/callback" "https://$Hostname/.auth/login/aad/callback" -o none
} else {
  Write-Host 'Entra-App nicht gefunden - Redirect-URI bitte manuell ergaenzen.' -ForegroundColor Yellow
}

# Sucht ein vorhandenes Zertifikat fuer den Hostnamen (Filter in PowerShell statt JMESPath - cmd.exe-sicher)
function FindThumb {
  $certs = @(AzOk webapp config ssl list -g $ResourceGroup -o json | ConvertFrom-Json)
  $c = $certs | Where-Object { $_.subjectName -eq $Hostname -or ($_.hostNames -contains $Hostname) } | Select-Object -First 1
  if ($c) { return $c.thumbprint } else { return $null }
}

Step 'Kostenloses App-Service-Managed-Zertifikat erstellen'
$thumb = FindThumb
if ($thumb) {
  Write-Host "Zertifikat existiert bereits ($thumb)."
} else {
  # Wird bei neueren az-Versionen asynchron erstellt -> danach warten
  & az webapp config ssl create -g $ResourceGroup -n $AppName --hostname $Hostname -o none
  Write-Host 'Warte, bis Azure das Zertifikat ausgestellt hat (meist 1-5 Minuten)...'
  for ($i = 0; $i -lt 60 -and -not $thumb; $i++) {
    Start-Sleep -Seconds 10
    $thumb = FindThumb
    if (-not $thumb) { Write-Host '.' -NoNewline }
  }
  Write-Host ''
  if (-not $thumb) { throw 'Zertifikat nach 10 Minuten noch nicht fertig - Skript spaeter mit -Bind erneut starten.' }
  Write-Host "Zertifikat ausgestellt ($thumb)."
}

Step 'Zertifikat binden (SNI)'
AzOk webapp config ssl bind -g $ResourceGroup -n $AppName --certificate-thumbprint $thumb --ssl-type SNI -o none

Step 'Fertig'
Write-Host "SIT-Cockpit ist erreichbar unter https://$Hostname"
