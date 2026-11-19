<#
.SYNOPSIS
  Naechtliche Datensicherung fuer SIT-Cockpit und SIT-Time einrichten:
  privater Storage Account + Container, Aufbewahrung 90 Tage (Lifecycle-Regel),
  Berechtigungen fuer die GitHub-Deploy-Identitaet (OIDC, kein Passwort).
  Die Sicherung selbst laeuft im Workflow .github/workflows/backup.yml.

.BEISPIEL
  .\infra\5-setup-backup.ps1

  Kann gefahrlos erneut ausgefuehrt werden.
#>
param(
  [string] $ResourceGroup  = 'rg-sit-time',
  [string] $Location       = 'westeurope',
  [string] $StorageAccount = 'stsitbackupschwaiger',     # global eindeutig, 3-24 Kleinbuchstaben/Ziffern
  [string] $Container      = 'app-data-backups',
  [int]    $RetentionDays  = 90,
  [string[]] $Apps         = @('sit-cockpit-schwaiger', 'sit-time-schwaiger'),
  [string] $DeployAppName  = 'SIT-Cockpit GitHub Deploy (sit-cockpit-schwaiger)',
  [string] $GitHubRepo     = 'Schwaiger-BUSINESS-IT-GmbH/SIT-Cockpit'
)
$ErrorActionPreference = 'Continue'
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function AzOk { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') fehlgeschlagen" }; $out }
function AzTry { & az @args 2>&1 | Out-Null; $LASTEXITCODE -eq 0 }
function WriteJson($obj) { $p = [IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($p, (ConvertTo-Json -InputObject $obj -Depth 20)); $p }

Step "Storage Account $StorageAccount (privat, nur TLS 1.2, kein oeffentlicher Zugriff)"
if (-not (AzTry storage account show -g $ResourceGroup -n $StorageAccount -o none)) {
  AzOk storage account create -g $ResourceGroup -n $StorageAccount -l $Location --sku Standard_LRS --kind StorageV2 `
    --min-tls-version TLS1_2 --allow-blob-public-access false --allow-shared-key-access false --https-only true -o none
}
$saId = AzOk storage account show -g $ResourceGroup -n $StorageAccount --query id -o tsv

Step 'Berechtigungen'
$me = AzOk ad signed-in-user show --query id -o tsv
$deployAppId = AzOk ad app list --display-name $DeployAppName --query '[0].appId' -o tsv
if (-not $deployAppId) { throw "Deploy-App '$DeployAppName' nicht gefunden (zuerst 1-setup-azure.ps1)" }
$deploySp = AzOk ad sp show --id $deployAppId --query id -o tsv
# Deploy-Identitaet: Blobs schreiben/lesen; ich (Admin): Blobs lesen fuer Wiederherstellung
foreach ($a in @(@{ id = $deploySp; type = 'ServicePrincipal' }, @{ id = $me; type = 'User' })) {
  if (-not (AzTry role assignment create --assignee-object-id $a.id --assignee-principal-type $a.type --role 'Storage Blob Data Contributor' --scope $saId -o none)) {
    Write-Host '(Rollenzuweisung existiert evtl. schon)'
  }
}
# Deploy-Identitaet muss den Datenordner aller gesicherten Apps lesen koennen (Kudu)
foreach ($app in $Apps) {
  $appId = AzOk webapp show -g $ResourceGroup -n $app --query id -o tsv
  if (-not (AzTry role assignment create --assignee-object-id $deploySp --assignee-principal-type ServicePrincipal --role 'Website Contributor' --scope $appId -o none)) {
    Write-Host "(Rolle fuer $app existiert evtl. schon)"
  }
}

Step "Container $Container"
Start-Sleep -Seconds 20   # Rollenzuweisung braucht kurz, bis sie greift
$ok = $false
for ($i = 0; $i -lt 6 -and -not $ok; $i++) {
  $ok = AzTry storage container create --account-name $StorageAccount -n $Container --auth-mode login -o none
  if (-not $ok) { Start-Sleep -Seconds 20 }
}
if (-not $ok) { throw 'Container konnte nicht angelegt werden (Rollenzuweisung noch nicht aktiv?) - Skript spaeter erneut starten.' }

Step "Aufbewahrung: Sicherungen aelter als $RetentionDays Tage automatisch loeschen"
$policy = @{ rules = @(@{ enabled = $true; name = 'delete-old-backups'; type = 'Lifecycle'; definition = @{
  filters = @{ blobTypes = @('blockBlob'); prefixMatch = @("$Container/") }
  actions = @{ baseBlob = @{ delete = @{ daysAfterModificationGreaterThan = $RetentionDays } } }
} }) }
AzOk storage account management-policy create --account-name $StorageAccount -g $ResourceGroup --policy "@$(WriteJson $policy)" -o none

Step 'GitHub-Variablen fuer den Backup-Workflow'
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh variable set BACKUP_STORAGE_ACCOUNT --body $StorageAccount --repo $GitHubRepo
  gh variable set BACKUP_CONTAINER --body $Container --repo $GitHubRepo
  gh variable set BACKUP_APPS --body ($Apps -join ' ') --repo $GitHubRepo
} else {
  Write-Host "Bitte im Repo als Actions-Variablen anlegen: BACKUP_STORAGE_ACCOUNT=$StorageAccount, BACKUP_CONTAINER=$Container, BACKUP_APPS=$($Apps -join ' ')" -ForegroundColor Yellow
}

Step 'Fertig'
Write-Host "Sicherungen landen in https://$StorageAccount.blob.core.windows.net/$Container/<app>/<datum>.zip"
Write-Host 'Ersten Lauf starten: gh workflow run backup.yml'
