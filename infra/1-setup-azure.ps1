<#
.SYNOPSIS
  Einmal-Setup fuer SIT-Cockpit in Azure:
  Resource Group, App Service Plan (Linux B1), Web App (Node 22), App Settings,
  Microsoft-Login (Entra ID / Easy Auth) und GitHub-Actions-Deployment per OIDC.

.VORAUSSETZUNGEN
  - Azure CLI (https://aka.ms/installazurecliwindows), angemeldet: az login
  - Rechte: Contributor + User Access Administrator auf der Subscription,
    in Entra ID: App-Registrierungen anlegen
  - Optional: GitHub CLI (gh), angemeldet - dann werden die Repo-Secrets automatisch gesetzt

.BEISPIEL
  .\infra\1-setup-azure.ps1 -WeclappTenant schwaiger -GitHubRepo schwaiger-it/SIT-Cockpit

  Das Skript kann gefahrlos erneut ausgefuehrt werden (bestehende Ressourcen werden wiederverwendet).
#>
param(
  [Parameter(Mandatory)] [string] $WeclappTenant,          # z.B. "sit01" oder "https://sit01.weclapp.com"
  [Parameter(Mandatory)] [string] $GitHubRepo,             # "org/repo"
  [string] $AteraApiKey = '',                              # Atera > Admin > API (wird nur gesetzt, wenn angegeben)
  [string] $AppName       = 'sit-cockpit-schwaiger',          # global eindeutig -> <AppName>.azurewebsites.net
  [string] $ResourceGroup = 'rg-sit-time',                 # gemeinsam mit SIT-Time (Plan muss in derselben RG liegen)
  [string] $PlanName      = 'asp-sit-time-schwaiger',      # bestehenden Plan mitnutzen; leer = eigener Plan asp-<AppName>
  [string] $Location      = 'westeurope',
  [string] $PlanSku       = 'B1',
  [string] $GitHubBranch  = 'main',
  [string] $AllowedGroupId = ''                            # optional: nur Mitglieder dieser Entra-Gruppe duerfen rein
)

# Mandant normalisieren: "https://sit01.weclapp.com" -> "sit01"
$WeclappTenant = ($WeclappTenant -replace '^https?://', '' -replace '\.weclapp\.com.*$', '').Trim('/')

$ErrorActionPreference = 'Continue'   # Fehler von az werden ueber AzOk (Exit-Code) abgefangen
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function AzOk { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') fehlgeschlagen" }; $out }
# Fuehrt az aus und liefert $true/$false statt abzubrechen (fuer "existiert schon?"-Pruefungen)
function AzTry { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & az @args 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }; $LASTEXITCODE -eq 0 }
function NewSecret { $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) }
function WriteJson($obj) { $p = [IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($p, (ConvertTo-Json -InputObject $obj -Depth 20)); $p }

Step 'Azure-Kontext pruefen'
$account = AzOk account show -o json | ConvertFrom-Json
$subId = $account.id; $tenantId = $account.tenantId
Write-Host "Subscription: $($account.name) ($subId)"
Write-Host "Tenant:       $tenantId"

# ---------------------------------------------------------------- Ressourcen
Step "Resource Group $ResourceGroup ($Location)"
AzOk group create -n $ResourceGroup -l $Location -o none

$plan = $(if ($PlanName) { $PlanName } else { "asp-$AppName" })
Step "App Service Plan $plan ($PlanSku, Linux)"
if (-not (AzTry appservice plan show -g $ResourceGroup -n $plan -o none)) { AzOk appservice plan create -g $ResourceGroup -n $plan --is-linux --sku $PlanSku -o none }

Step "Web App $AppName (Node 22)"
if (-not (AzTry webapp show -g $ResourceGroup -n $AppName -o none)) {
  AzOk webapp create -g $ResourceGroup -p $plan -n $AppName --runtime 'NODE:22-lts' --https-only true --basic-auth Disabled -o none
}
$hostName = "$AppName.azurewebsites.net"
$webAppId = AzOk webapp show -g $ResourceGroup -n $AppName --query id -o tsv

Step 'Web-App-Konfiguration (Startbefehl, Always On, TLS, Health Check)'
AzOk webapp config set -g $ResourceGroup -n $AppName `
  --startup-file 'node server/index.js' --always-on true --min-tls-version 1.2 `
  --ftps-state Disabled --http20-enabled true --generic-configurations 'healthCheckPath=/healthz' -o none

Step 'App Settings'
$existing = AzOk webapp config appsettings list -g $ResourceGroup -n $AppName -o json | ConvertFrom-Json
$sessionSecret = ($existing | Where-Object name -eq 'SESSION_SECRET').value
if (-not $sessionSecret) { $sessionSecret = NewSecret }
AzOk webapp config appsettings set -g $ResourceGroup -n $AppName -o none --settings `
  "WECLAPP_TENANT=$WeclappTenant" "SESSION_SECRET=$sessionSecret" `
  'COOKIE_SECURE=1' 'REQUIRE_ENTRA=1' 'DATA_DIR=/home/data' 'ROUND_MINUTES=15' `
  'ARTICLE_TYPE=SERVICE' 'SCM_DO_BUILD_DURING_DEPLOYMENT=false' 'WEBSITES_ENABLE_APP_SERVICE_STORAGE=true' `
  "WECLAPP_WEB_URL=https://$WeclappTenant.weclapp.com/webapp"
if ($AteraApiKey) {
  AzOk webapp config appsettings set -g $ResourceGroup -n $AppName -o none --settings "ATERA_API_KEY=$AteraApiKey"
} elseif (-not ($existing | Where-Object name -eq 'ATERA_API_KEY')) {
  Write-Host 'Hinweis: ATERA_API_KEY fehlt noch - erneut mit -AteraApiKey ausfuehren oder im Portal setzen.' -ForegroundColor Yellow
}

# ---------------------------------------------------------------- Entra ID (Easy Auth)
Step 'Entra-App-Registrierung fuer den Microsoft-Login'
$authAppName = "SIT-Cockpit ($AppName)"
$authAppId = AzOk ad app list --display-name $authAppName --query '[0].appId' -o tsv
$graphUserRead = @(@{ resourceAppId = '00000003-0000-0000-c000-000000000000'; resourceAccess = @(@{ id = 'e1fe6dd8-ba31-4d61-89e7-88639da4683d'; type = 'Scope' }) })
$rraFile = WriteJson $graphUserRead
if (-not $authAppId) {
  $authAppId = AzOk ad app create --display-name $authAppName --sign-in-audience AzureADMyOrg `
    --web-redirect-uris "https://$hostName/.auth/login/aad/callback" `
    --enable-id-token-issuance true --required-resource-accesses "@$rraFile" --query appId -o tsv
  Start-Sleep -Seconds 10  # Entra-Replikation abwarten
}
if (-not (AzTry ad sp show --id $authAppId -o none)) { AzOk ad sp create --id $authAppId -o none }
$authSpObjectId = AzOk ad sp show --id $authAppId --query id -o tsv

# Admin-Consent fuer User.Read, sonst sehen normale User 'Administratorgenehmigung erforderlich'
Start-Sleep -Seconds 10
if (AzTry ad app permission admin-consent --id $authAppId) { Write-Host 'Admin-Consent erteilt.' }
else { Write-Host "Admin-Consent fehlgeschlagen - im Portal erteilen: Entra ID > Unternehmensanwendungen > SIT-Cockpit ($AppName) > Berechtigungen" -ForegroundColor Yellow }

$secretName = 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
$useSecret = [bool]($existing | Where-Object name -eq $secretName)
if (-not $useSecret) {
  # Manche Tenants verbieten Client-Secrets per App-Management-Policy.
  # Dann laeuft Easy Auth ohne Secret (ID-Token-Flow) - fuer reinen Login voellig ausreichend.
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $clientSecret = & az ad app credential reset --id $authAppId --append --display-name 'EasyAuth' --years 2 --query password -o tsv 2>$null
  $ok = ($LASTEXITCODE -eq 0) -and $clientSecret
  $ErrorActionPreference = $old
  if ($ok) {
    AzOk webapp config appsettings set -g $ResourceGroup -n $AppName -o none --settings "$secretName=$clientSecret"
    $useSecret = $true
    Write-Host 'Client-Secret angelegt (2 Jahre gueltig) - Ablauf im Kalender vormerken!' -ForegroundColor Yellow
  } else {
    Write-Host 'Client-Secret im Tenant nicht erlaubt (Policy) -> Easy Auth ohne Secret (ID-Token-Flow).' -ForegroundColor Yellow
  }
}

if ($AllowedGroupId) {
  Step "Zugriff auf Entra-Gruppe $AllowedGroupId beschraenken"
  AzOk ad sp update --id $authSpObjectId --set appRoleAssignmentRequired=true -o none
  $assignFile = WriteJson @{ principalId = $AllowedGroupId; resourceId = $authSpObjectId; appRoleId = '00000000-0000-0000-0000-000000000000' }
  if (-not (AzTry rest --method post --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$authSpObjectId/appRoleAssignedTo" --body "@$assignFile" -o none)) {
    Write-Host '(Gruppe war evtl. schon zugewiesen)'
  }
}

Step 'Easy Auth aktivieren (authsettingsV2)'
$auth = @{
  properties = @{
    platform         = @{ enabled = $true }
    globalValidation = @{
      requireAuthentication       = $true
      unauthenticatedClientAction = 'RedirectToLoginPage'
      redirectToProvider          = 'azureactivedirectory'
      excludedPaths               = @('/healthz', '/.well-known', '/.well-known/*')
    }
    identityProviders = @{
      azureActiveDirectory = @{
        enabled      = $true
        registration = $(if ($useSecret) {
          @{ openIdIssuer = "https://login.microsoftonline.com/$tenantId/v2.0"; clientId = $authAppId; clientSecretSettingName = $secretName }
        } else {
          @{ openIdIssuer = "https://login.microsoftonline.com/$tenantId/v2.0"; clientId = $authAppId }
        })
        validation = @{ allowedAudiences = @("api://$authAppId", $authAppId) }
      }
    }
    login        = @{ tokenStore = @{ enabled = $true }; cookieExpiration = @{ convention = 'FixedTime'; timeToExpiration = '7.00:00:00' } }
    httpSettings = @{ requireHttps = $true }
  }
}
$authFile = WriteJson $auth
AzOk rest --method put --uri "https://management.azure.com$webAppId/config/authsettingsV2?api-version=2022-03-01" --body "@$authFile" -o none

# ---------------------------------------------------------------- GitHub Deployment (OIDC)
Step "GitHub-Deployment fuer $GitHubRepo ($GitHubBranch) per OIDC"
$deployAppName = "SIT-Cockpit GitHub Deploy ($AppName)"
$deployAppId = AzOk ad app list --display-name $deployAppName --query '[0].appId' -o tsv
if (-not $deployAppId) {
  $deployAppId = AzOk ad app create --display-name $deployAppName --sign-in-audience AzureADMyOrg --query appId -o tsv
  Start-Sleep -Seconds 10
}
if (-not (AzTry ad sp show --id $deployAppId -o none)) { AzOk ad sp create --id $deployAppId -o none; Start-Sleep -Seconds 15 }
$deploySpObjectId = AzOk ad sp show --id $deployAppId --query id -o tsv

$fedName = 'github-' + $GitHubBranch
# Filter in PowerShell statt JMESPath: Klammern in --query zerlegt cmd.exe (az.cmd) unter Windows
$feds = @(AzOk ad app federated-credential list --id $deployAppId -o json | ConvertFrom-Json)
if (-not ($feds | Where-Object name -eq $fedName)) {
  $fedFile = WriteJson @{
    name      = $fedName
    issuer    = 'https://token.actions.githubusercontent.com'
    subject   = "repo:${GitHubRepo}:ref:refs/heads/$GitHubBranch"
    audiences = @('api://AzureADTokenExchange')
  }
  AzOk ad app federated-credential create --id $deployAppId --parameters "@$fedFile" -o none
}
if (-not (AzTry role assignment create --assignee-object-id $deploySpObjectId --assignee-principal-type ServicePrincipal `
    --role 'Website Contributor' --scope $webAppId -o none)) {
  Write-Host '(Rollenzuweisung existiert evtl. schon)'
}

$secrets = [ordered]@{
  AZURE_CLIENT_ID       = $deployAppId
  AZURE_TENANT_ID       = $tenantId
  AZURE_SUBSCRIPTION_ID = $subId
}
if (Get-Command gh -ErrorAction SilentlyContinue) {
  Step 'GitHub-Secrets/Variablen setzen (gh)'
  foreach ($k in $secrets.Keys) { gh secret set $k --body $secrets[$k] --repo $GitHubRepo }
  gh variable set AZURE_WEBAPP_NAME --body $AppName --repo $GitHubRepo
} else {
  Write-Host "`nGitHub CLI nicht gefunden. Bitte im Repo unter Settings -> Secrets and variables -> Actions anlegen:" -ForegroundColor Yellow
  foreach ($k in $secrets.Keys) { Write-Host "  Secret   $k = $($secrets[$k])" }
  Write-Host "  Variable AZURE_WEBAPP_NAME = $AppName"
}

Step 'Fertig'
Write-Host "App-URL:  https://$hostName"
Write-Host 'Naechste Schritte:'
Write-Host '  1. Code nach GitHub pushen -> Workflow "Deploy to Azure" laeuft automatisch'
Write-Host '  2. Eigene Domain: .\infra\2-custom-domain.ps1 -Hostname cockpit.schwaiger-it.at'
