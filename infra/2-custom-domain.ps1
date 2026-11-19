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
  [string] $ResourceGroup = 'rg-sit-time',
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

# Kostenloses App-Service-Zertifikat (DigiCert/GeoTrust).
# Erfahrungen aus der Einrichtung von cockpit.schwaiger-it.at:
#  - Die CAA-Eintraege der Hauptdomain muessen "digicert.com" erlauben, sonst haengt die Ausstellung
#    ohne Fehlermeldung (schwaiger-it.at: CAA 0 issue "digicert.com" ergaenzt).
#  - Waehrend der Ausstellung "Nur HTTPS" kurz ausschalten (Pruefung laeuft ueber HTTP).
#  - Eine haengende Anforderung blockiert neue unter demselben Ressourcennamen -> eigener Name.
#  - "az webapp config ssl bind" stuerzt mit einem CLI-Fehler ab -> Bindung per REST.
$sub = AzOk account show --query id -o tsv
$plan = AzOk webapp show -g $ResourceGroup -n $AppName --query appServicePlanId -o tsv
$certName = ($Hostname -replace '\.', '-') + '-managed'
$certUri = "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.Web/certificates/${certName}?api-version=2023-01-01"
function Token { AzOk account get-access-token --resource 'https://management.azure.com/' --query accessToken -o tsv }

Step 'Kostenloses App-Service-Managed-Zertifikat'
$c = Invoke-WebRequest -Uri $certUri -Headers @{ Authorization = "Bearer $(Token)" } -SkipHttpErrorCheck
$thumb = if ($c.StatusCode -eq 200) { ([string]$c.Content | ConvertFrom-Json).properties.thumbprint } else { $null }
if ($thumb) { Write-Host "Zertifikat existiert bereits ($thumb)." }
else {
  AzOk webapp update -g $ResourceGroup -n $AppName --https-only false -o none
  try {
    $body = @{ location = (AzOk webapp show -g $ResourceGroup -n $AppName --query location -o tsv); properties = @{ canonicalName = $Hostname; serverFarmId = $plan } } | ConvertTo-Json -Depth 5
    $r = Invoke-WebRequest -Method Put -Uri $certUri -Headers @{ Authorization = "Bearer $(Token)" } -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
    if ($r.StatusCode -ge 400) { throw "Zertifikat-Anforderung abgelehnt: HTTP $($r.StatusCode) $([string]$r.Content)" }
    Write-Host 'Warte, bis Azure das Zertifikat ausgestellt hat (meist 2-5 Minuten)...'
    for ($i = 0; $i -lt 60 -and -not $thumb; $i++) {
      Start-Sleep -Seconds 15
      $c = Invoke-WebRequest -Uri $certUri -Headers @{ Authorization = "Bearer $(Token)" } -SkipHttpErrorCheck
      if ($c.StatusCode -eq 200) { $thumb = ([string]$c.Content | ConvertFrom-Json).properties.thumbprint }
      if (-not $thumb) { Write-Host '.' -NoNewline }
    }
    Write-Host ''
  } finally {
    AzOk webapp update -g $ResourceGroup -n $AppName --https-only true -o none
  }
  if (-not $thumb) { throw 'Kein Zertifikat nach 15 Minuten - CAA-Eintraege pruefen (digicert.com erlaubt?) und spaeter erneut mit -Bind starten.' }
  Write-Host "Zertifikat ausgestellt ($thumb)."
}

Step 'Zertifikat binden (SNI)'
$bindUri = "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/hostNameBindings/${Hostname}?api-version=2023-01-01"
$bind = @{ properties = @{ siteName = $AppName; hostNameType = 'Verified'; sslState = 'SniEnabled'; thumbprint = $thumb } } | ConvertTo-Json -Depth 5
$r = Invoke-WebRequest -Method Put -Uri $bindUri -Headers @{ Authorization = "Bearer $(Token)" } -ContentType 'application/json' -Body $bind -SkipHttpErrorCheck
if ($r.StatusCode -ge 400) { throw "Bindung fehlgeschlagen: HTTP $($r.StatusCode) $([string]$r.Content)" }

Step 'Fertig'
Write-Host "SIT-Cockpit ist erreichbar unter https://$Hostname"
