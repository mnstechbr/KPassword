param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDir
)

$ErrorActionPreference = "Stop"

$Errors = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Write-Ok {
  param([string]$Message)
  Write-Host "OK    $Message" -ForegroundColor Green
}

function Add-ValidationError {
  param([string]$Message)
  $Errors.Add($Message) | Out-Null
  Write-Host "ERRO  $Message" -ForegroundColor Red
}

function Add-ValidationWarning {
  param([string]$Message)
  $Warnings.Add($Message) | Out-Null
  Write-Host "AVISO $Message" -ForegroundColor Yellow
}

function Get-RelativeReleasePath {
  param(
    [Parameter(Mandatory = $true)] [string]$BasePath,
    [Parameter(Mandatory = $true)] [string]$FullPath
  )

  $normalizedBase = $BasePath.TrimEnd('\', '/')
  if ($FullPath.StartsWith($normalizedBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $FullPath.Substring($normalizedBase.Length).TrimStart('\', '/')
  }

  return $FullPath
}

Write-Host ""
Write-Host "Geracao de SHA256SUMS do KPassword" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath $ReleaseDir -PathType Container)) {
  Add-ValidationError "Pasta de release nao encontrada: $ReleaseDir"
  Write-Host ""
  Write-Host "Geracao falhou com $($Errors.Count) erro(s)." -ForegroundColor Red
  exit 1
}

$ResolvedReleaseDir = (Resolve-Path -LiteralPath $ReleaseDir).ProviderPath
$ReleaseFiles = @(Get-ChildItem -LiteralPath $ResolvedReleaseDir -File)
$AllReleaseFiles = @(Get-ChildItem -LiteralPath $ResolvedReleaseDir -File -Recurse)
$OutputPath = Join-Path $ResolvedReleaseDir "SHA256SUMS.txt"

Write-Host "Pasta: $ResolvedReleaseDir"
Write-Host ""

$SensitivePattern = '(?i)(^|[\\/])\.env($|[\\/])|\.env($|\.)|\.key$|\.pem$|private|secret|token|backup|\.kpvault$|\.kphello$'
$SensitiveFiles = @()
foreach ($File in $AllReleaseFiles) {
  $RelativePath = Get-RelativeReleasePath -BasePath $ResolvedReleaseDir -FullPath $File.FullName
  if ($RelativePath -match $SensitivePattern) {
    $SensitiveFiles += $RelativePath
  }
}

if ($SensitiveFiles.Count -gt 0) {
  Add-ValidationError "Arquivo sensivel encontrado na pasta de release: $($SensitiveFiles -join ', ')"
}

$PublicAssets = @(
  $ReleaseFiles |
    Where-Object {
      $_.Name -ieq "latest.json" -or
      $_.Name -match '(?i)^KPassword.*\.exe$' -or
      $_.Name -match '(?i)^KPassword.*\.exe\.sig$'
    } |
    Sort-Object @{ Expression = { $_.Name.ToLowerInvariant() } }
)

if ($PublicAssets.Count -eq 0) {
  Add-ValidationError "Nenhum asset publico encontrado para gerar SHA256SUMS.txt."
}

$SkippedFiles = @(
  $ReleaseFiles |
    Where-Object {
      $_.FullName -ne $OutputPath -and
      -not (
        $_.Name -ieq "latest.json" -or
        $_.Name -match '(?i)^KPassword.*\.exe$' -or
        $_.Name -match '(?i)^KPassword.*\.exe\.sig$'
      )
    } |
    Select-Object -ExpandProperty Name
)

if ($SkippedFiles.Count -gt 0) {
  Add-ValidationWarning "Arquivos ignorados por nao serem assets publicos: $($SkippedFiles -join ', ')"
}

if ($Errors.Count -gt 0) {
  Write-Host ""
  Write-Host "Geracao falhou com $($Errors.Count) erro(s). Nenhum SHA256SUMS.txt foi gerado." -ForegroundColor Red
  exit 1
}

$Lines = New-Object System.Collections.Generic.List[string]
foreach ($Asset in $PublicAssets) {
  $Hash = (Get-FileHash -LiteralPath $Asset.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $Lines.Add("$Hash  $($Asset.Name)") | Out-Null
  Write-Ok "SHA256 calculado: $($Asset.Name)"
}

$Content = ($Lines -join [Environment]::NewLine) + [Environment]::NewLine
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, $Content, $Utf8NoBom)

Write-Host ""
Write-Host "SHA256SUMS.txt gerado:" -ForegroundColor Green
Write-Host $OutputPath
Write-Host ""
Write-Host "Resumo:" -ForegroundColor Cyan
Write-Host "Assets incluidos: $($PublicAssets.Count)"
Write-Host "Avisos: $($Warnings.Count)"
Write-Host "Erros: 0"
exit 0
