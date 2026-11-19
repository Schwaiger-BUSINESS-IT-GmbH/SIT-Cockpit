<#
.SYNOPSIS
  Zugriff auf den Bereich "Finanzen" einrichten: Entra-Sicherheitsgruppe anlegen,
  Mitglieder aufnehmen, Gruppen-Claim im Microsoft-Login aktivieren und die
  Gruppen-ID im Cockpit hinterlegen (App Setting FINANCE_GROUP_ID).

.BEISPIEL
  .\infra\7-setup-finance-access.ps1                                   # Gruppe + du selbst
  .\infra\7-setup-finance-access.ps1 -Members buchhaltung@firma.at     # weitere Mitglieder

  Danach einmal im Cockpit abmelden und neu anmelden (der Gruppen-Claim kommt mit dem neuen Login).
  Mitglieder spaeter einfach in Entra ID unter Gruppen > "SIT-Cockpit Finanzen" pflegen.
#>
param(
  [string]   $GroupName     = 'SIT-Cockpit Finanzen',
  [string[]] $Members       = @(),
  [string]   $AppName       = 'sit-cockpit-schwaiger',
  [string]   $ResourceGroup = 'rg-sit-time'
)
$ErrorActionPreference = 'Continue'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function AzOk { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') fehlgeschlagen" }; $out }

Step "Entra-Gruppe '$GroupName'"
$groupId = AzOk ad group list --display-name $GroupName --query '[0].id' -o tsv
if (-not $groupId) {
  $nick = ($GroupName -replace '[^A-Za-z0-9]', '').ToLower()
  $groupId = AzOk ad group create --display-name $GroupName --mail-nickname $nick --description 'Zugriff auf Finanzen im SIT-Cockpit (Geschaeftsfuehrung/Buchhaltung)' --query id -o tsv
  Write-Host "Angelegt: $groupId"
} else { Write-Host "Existiert bereits: $groupId" }

Step 'Mitglieder'
$ids = @(AzOk ad signed-in-user show --query id -o tsv)
foreach ($m in $Members) { $ids += AzOk ad user show --id $m --query id -o tsv }
foreach ($id in $ids | Select-Object -Unique) {
  $isMember = AzOk ad group member check --group $groupId --member-id $id --query value -o tsv
  if ($isMember -ne 'true') { AzOk ad group member add --group $groupId --member-id $id; Write-Host "  aufgenommen: $id" } else { Write-Host "  schon Mitglied: $id" }
}

Step 'Gruppen-Claim im Microsoft-Login aktivieren'
$webAppId = AzOk webapp show -g $ResourceGroup -n $AppName --query id -o tsv
$clientId = AzOk rest --method get --uri "https://management.azure.com$webAppId/config/authsettingsV2?api-version=2022-03-01" --query 'properties.identityProviders.azureActiveDirectory.registration.clientId' -o tsv
if (-not $clientId) { throw 'Login-App (Easy Auth) nicht gefunden.' }
AzOk ad app update --id $clientId --set groupMembershipClaims=SecurityGroup
Write-Host "Login-App $clientId liefert jetzt Sicherheitsgruppen im Token."

Step 'Gruppe im Cockpit hinterlegen'
AzOk webapp config appsettings set -g $ResourceGroup -n $AppName --settings "FINANCE_GROUP_ID=$groupId" -o none
Write-Host 'FINANCE_GROUP_ID gesetzt (App startet neu).'

Step 'Fertig'
Write-Host 'Wichtig: Im Cockpit einmal abmelden und neu anmelden - erst dann enthaelt der Login die Gruppe.' -ForegroundColor Yellow
