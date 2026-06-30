param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

function Set-JsonProperty {
  param(
    [Parameter(Mandatory = $true)] [object] $Object,
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] $Value
  )

  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  } else {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value -Force
  }
}

function Ensure-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)] [object] $Object,
    [Parameter(Mandatory = $true)] [string] $Name
  )

  if (($Object.PSObject.Properties.Name -notcontains $Name) -or ($null -eq $Object.$Name)) {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value ([pscustomobject]@{}) -Force
  }

  return $Object.$Name
}

$ConfigPath = Join-Path $Project "src-tauri\tauri.conf.json"
$IconPng = Join-Path $Project "app-icon.png"
$IconIco = Join-Path $Project "src-tauri\icons\icon.ico"
$BundleDir = Join-Path $Project "src-tauri\target\release\bundle"

if (-not (Test-Path $ConfigPath)) {
  throw "tauri.conf.json não encontrado em: $ConfigPath"
}

if (-not (Test-Path $IconPng)) {
  throw "app-icon.png não encontrado em: $IconPng"
}

Set-Location $Project

Write-Host ""
Write-Host "Gerando novamente os ícones do Tauri a partir de app-icon.png..." -ForegroundColor Cyan
npm run tauri icon app-icon.png

if (-not (Test-Path $IconIco)) {
  throw "icon.ico não foi gerado em: $IconIco"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = "$ConfigPath.backup-installer-icon-v2-$timestamp"
Copy-Item $ConfigPath $BackupPath -Force

$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

$bundle = Ensure-ObjectProperty -Object $config -Name "bundle"
Set-JsonProperty -Object $bundle -Name "active" -Value $true

Set-JsonProperty -Object $bundle -Name "icon" -Value @(
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
)

$windows = Ensure-ObjectProperty -Object $bundle -Name "windows"
$nsis = Ensure-ObjectProperty -Object $windows -Name "nsis"

Set-JsonProperty -Object $nsis -Name "installerIcon" -Value "icons/icon.ico"
Set-JsonProperty -Object $nsis -Name "uninstallerIcon" -Value "icons/icon.ico"

if ($nsis.PSObject.Properties.Name -notcontains "installMode" -or [string]::IsNullOrWhiteSpace([string]$nsis.installMode)) {
  Set-JsonProperty -Object $nsis -Name "installMode" -Value "currentUser"
}

$config | ConvertTo-Json -Depth 100 | Set-Content -Path $ConfigPath -Encoding UTF8

if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}

Write-Host ""
Write-Host "Configuração NSIS corrigida com sucesso." -ForegroundColor Green
Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "Confira se estas linhas existem no tauri.conf.json:" -ForegroundColor Cyan
Write-Host 'bundle.windows.nsis.installerIcon = "icons/icon.ico"' -ForegroundColor White
Write-Host 'bundle.windows.nsis.uninstallerIcon = "icons/icon.ico"' -ForegroundColor White
Write-Host ""
Write-Host "Agora rode:" -ForegroundColor Cyan
Write-Host "npm run tauri build" -ForegroundColor White
Write-Host ""
