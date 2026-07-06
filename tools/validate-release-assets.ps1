param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDir,

  [string]$ExpectedVersion = ""
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

function Normalize-Version {
  param([string]$Value)
  return ([string]$Value).Trim() -replace '^[vV]', ''
}

function Get-FileNameFromUrl {
  param([string]$Url)

  if ([string]::IsNullOrWhiteSpace($Url)) {
    return ""
  }

  try {
    $uri = [Uri]$Url
    return [Uri]::UnescapeDataString([System.IO.Path]::GetFileName($uri.AbsolutePath))
  } catch {
    return [System.IO.Path]::GetFileName($Url)
  }
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

function Read-JsonFile {
  param([Parameter(Mandatory = $true)] [string]$Path)

  try {
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  } catch {
    Add-ValidationError "latest.json nao e JSON valido: $($_.Exception.Message)"
    return $null
  }
}

Write-Host ""
Write-Host "Validacao de assets de release do KPassword" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath $ReleaseDir -PathType Container)) {
  Add-ValidationError "Pasta de release nao encontrada: $ReleaseDir"
  Write-Host ""
  Write-Host "Validacao falhou com $($Errors.Count) erro(s)." -ForegroundColor Red
  exit 1
}

$ResolvedReleaseDir = (Resolve-Path -LiteralPath $ReleaseDir).ProviderPath
$ReleaseItem = Get-Item -LiteralPath $ResolvedReleaseDir
$ReleaseFiles = @(Get-ChildItem -LiteralPath $ResolvedReleaseDir -File)
$AllReleaseFiles = @(Get-ChildItem -LiteralPath $ResolvedReleaseDir -File -Recurse)

Write-Host "Pasta: $ResolvedReleaseDir"
Write-Host ""

$VersionPattern = '^v?(?<version>[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$'
if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = Normalize-Version $ExpectedVersion
  Write-Ok "Versao esperada informada: v$ExpectedVersion"
} elseif ($ReleaseItem.Name -match $VersionPattern) {
  $ExpectedVersion = Normalize-Version $Matches.version
  Write-Ok "Versao esperada inferida pela pasta: v$ExpectedVersion"
} else {
  Add-ValidationWarning "Versao esperada nao informada e nome da pasta nao segue o padrao vX.Y.Z."
}

$LatestJsonFile = $ReleaseFiles | Where-Object { $_.Name -ieq "latest.json" } | Select-Object -First 1
$LatestJson = $null
if ($LatestJsonFile) {
  Write-Ok "latest.json encontrado."
  $LatestJson = Read-JsonFile -Path $LatestJsonFile.FullName
  if ($LatestJson) {
    Write-Ok "latest.json e JSON valido."
  }
} else {
  Add-ValidationError "latest.json nao encontrado na pasta de release."
}

if ([string]::IsNullOrWhiteSpace($ExpectedVersion) -and $LatestJson -and $LatestJson.version) {
  $ExpectedVersion = Normalize-Version $LatestJson.version
  Add-ValidationWarning "Versao esperada inferida pelo latest.json: v$ExpectedVersion. Prefira usar uma pasta vX.Y.Z ou -ExpectedVersion."
}

$ExeFiles = @($ReleaseFiles | Where-Object { $_.Extension -ieq ".exe" })
$InstallerCandidates = @($ExeFiles | Where-Object { $_.Name -match '(?i)^KPassword.*\.exe$' })
$Installer = $null

if ($ExeFiles.Count -eq 0) {
  Add-ValidationError "Nenhum instalador .exe encontrado."
} elseif ($InstallerCandidates.Count -eq 0) {
  Add-ValidationError "Nenhum .exe do KPassword encontrado. Arquivos .exe detectados: $($ExeFiles.Name -join ', ')"
} else {
  if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
    $Installer = $InstallerCandidates |
      Where-Object { $_.Name.IndexOf($ExpectedVersion, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      Select-Object -First 1
  }

  if (-not $Installer) {
    $Installer = $InstallerCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }

  Write-Ok "Instalador encontrado: $($Installer.Name)"

  if ($InstallerCandidates.Count -gt 1) {
    Add-ValidationWarning "Mais de um instalador KPassword encontrado: $($InstallerCandidates.Name -join ', '). Validando $($Installer.Name)."
  }
}

if ($Installer -and -not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  if ($Installer.Name.IndexOf($ExpectedVersion, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Write-Ok "Nome do instalador contem a versao esperada v$ExpectedVersion."
  } else {
    Add-ValidationError "Nome do instalador nao contem a versao esperada v${ExpectedVersion}: $($Installer.Name)"
  }

  $ExpectedInstallerName = "KPassword-Setup-v$ExpectedVersion.exe"
  if ($Installer.Name -cne $ExpectedInstallerName) {
    Add-ValidationWarning "Nome do instalador difere do padrao atual $ExpectedInstallerName."
  } else {
    Write-Ok "Nome do instalador segue o padrao atual."
  }
}

$SigFile = $null
if ($Installer) {
  $ExpectedSigName = "$($Installer.Name).sig"
  $SigFile = $ReleaseFiles | Where-Object { $_.Name -ceq $ExpectedSigName } | Select-Object -First 1

  if ($SigFile) {
    Write-Ok "Assinatura correspondente encontrada: $($SigFile.Name)"
  } else {
    Add-ValidationError "Assinatura correspondente nao encontrada: $ExpectedSigName"
  }
}

if ($LatestJson) {
  if ($LatestJson.version) {
    $LatestVersion = Normalize-Version $LatestJson.version
    if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
      if ($LatestVersion -eq $ExpectedVersion) {
        Write-Ok "latest.json aponta para a versao esperada v$ExpectedVersion."
      } else {
        Add-ValidationError "latest.json aponta para v$LatestVersion, mas o esperado e v$ExpectedVersion."
      }
    } else {
      Write-Ok "latest.json informa versao v$LatestVersion."
    }
  } else {
    Add-ValidationError "latest.json nao possui campo version."
  }

  if ($LatestJson.pub_date) {
    try {
      [DateTimeOffset]::Parse([string]$LatestJson.pub_date) | Out-Null
      Write-Ok "latest.json possui pub_date valido."
    } catch {
      Add-ValidationWarning "latest.json possui pub_date, mas ele nao parece uma data valida."
    }
  } else {
    Add-ValidationWarning "latest.json nao possui pub_date."
  }

  $WindowsPlatform = $null
  if ($LatestJson.platforms) {
    $WindowsPlatformProperty = $LatestJson.platforms.PSObject.Properties["windows-x86_64"]
    if ($WindowsPlatformProperty) {
      $WindowsPlatform = $WindowsPlatformProperty.Value
      Write-Ok "latest.json possui plataforma windows-x86_64."
    } else {
      Add-ValidationError "latest.json nao possui platforms.windows-x86_64."
    }
  } else {
    Add-ValidationError "latest.json nao possui platforms."
  }

  if ($WindowsPlatform) {
    $UpdaterUrl = [string]$WindowsPlatform.url
    if ([string]::IsNullOrWhiteSpace($UpdaterUrl)) {
      Add-ValidationError "latest.json nao possui URL do instalador em platforms.windows-x86_64.url."
    } else {
      $UrlFileName = Get-FileNameFromUrl $UpdaterUrl
      if ($Installer -and $UrlFileName -eq $Installer.Name) {
        Write-Ok "URL do latest.json aponta para o asset do instalador."
      } elseif ($Installer) {
        Add-ValidationError "URL do latest.json aponta para '$UrlFileName', mas o instalador local e '$($Installer.Name)'."
      }

      if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
        $ExpectedReleasePath = "/mnstechbr/KPassword/releases/download/v$ExpectedVersion/"
        try {
          $Uri = [Uri]$UpdaterUrl
          $HostIsGitHub = $Uri.Host -ieq "github.com"
          $PathMatches = $Uri.AbsolutePath.IndexOf($ExpectedReleasePath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
          if ($HostIsGitHub -and $PathMatches) {
            Write-Ok "URL do latest.json usa o release GitHub esperado v$ExpectedVersion."
          } else {
            Add-ValidationError "URL do latest.json nao aponta para github.com$ExpectedReleasePath"
          }
        } catch {
          Add-ValidationError "URL do latest.json nao e uma URL valida: $UpdaterUrl"
        }
      }
    }

    $LatestSignature = ([string]$WindowsPlatform.signature).Trim()
    if ([string]::IsNullOrWhiteSpace($LatestSignature)) {
      Add-ValidationError "latest.json nao possui assinatura em platforms.windows-x86_64.signature."
    } elseif ($SigFile) {
      $SigContent = (Get-Content -Raw -LiteralPath $SigFile.FullName).Trim()
      if ($LatestSignature -eq $SigContent) {
        Write-Ok "Assinatura do latest.json bate com o arquivo .sig."
      } else {
        Add-ValidationError "Assinatura do latest.json nao bate com $($SigFile.Name)."
      }
    }
  }
}

$HashFiles = @($ReleaseFiles | Where-Object { $_.Name -match '(?i)^SHA256(SUMS)?(\.txt)?$' })
if ($HashFiles.Count -eq 0) {
  Add-ValidationWarning "Arquivo SHA256/SHA256SUMS nao encontrado. Hash externo e opcional, mas nao foi conferido."
} else {
  foreach ($HashFile in $HashFiles) {
    Write-Ok "Arquivo de hash encontrado: $($HashFile.Name)"
    $ValidHashLines = 0
    $Lines = @(Get-Content -LiteralPath $HashFile.FullName)

    foreach ($RawLine in $Lines) {
      $Line = ([string]$RawLine).Trim()
      if ([string]::IsNullOrWhiteSpace($Line) -or $Line.StartsWith("#")) {
        continue
      }

      $HashTargetName = ""
      if ($Line -match '(?i)^\s*(?<hash>[a-f0-9]{64})\s+\*?(?<name>.+?)\s*$') {
        $HashTargetName = [System.IO.Path]::GetFileName($Matches.name.Trim().Trim('"'))
      } elseif ($Line -notmatch '(?i)\b(?<hash>[a-f0-9]{64})\b') {
        Add-ValidationError "Linha de hash invalida em $($HashFile.Name): $Line"
        continue
      }

      $ExpectedHash = $Matches.hash.ToLowerInvariant()
      $TargetFile = $null

      if (-not [string]::IsNullOrWhiteSpace($HashTargetName)) {
        $TargetFile = $ReleaseFiles |
          Where-Object { $_.Name -ieq $HashTargetName -and $_.FullName -ne $HashFile.FullName } |
          Select-Object -First 1
      } else {
        foreach ($File in ($ReleaseFiles | Sort-Object @{ Expression = { $_.Name.Length } } -Descending)) {
          if ($File.FullName -eq $HashFile.FullName) {
            continue
          }

          if ($Line.IndexOf($File.Name, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $TargetFile = $File
            break
          }
        }
      }

      if (-not $TargetFile -and $Installer -and $HashFiles.Count -eq 1) {
        $TargetFile = $Installer
      }

      if (-not $TargetFile) {
        Add-ValidationError "Nao foi possivel identificar o arquivo da linha de hash em $($HashFile.Name): $Line"
        continue
      }

      $ActualHash = (Get-FileHash -LiteralPath $TargetFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($ActualHash -eq $ExpectedHash) {
        Write-Ok "SHA256 confere para $($TargetFile.Name)."
        $ValidHashLines++
      } else {
        Add-ValidationError "SHA256 nao confere para $($TargetFile.Name). Esperado $ExpectedHash, obtido $ActualHash."
      }
    }

    if ($ValidHashLines -eq 0) {
      Add-ValidationError "Nenhuma linha de hash valida foi conferida em $($HashFile.Name)."
    }
  }
}

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
} else {
  Write-Ok "Nenhum arquivo sensivel encontrado na pasta de release."
}

$KnownAssetNames = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
@("latest.json", "UPLOAD_THESE_FILES.txt", "UPLOAD_NO_GITHUB.txt") | ForEach-Object { $KnownAssetNames.Add($_) | Out-Null }
foreach ($HashFile in $HashFiles) {
  $KnownAssetNames.Add($HashFile.Name) | Out-Null
}
if ($Installer) {
  $KnownAssetNames.Add($Installer.Name) | Out-Null
  $KnownAssetNames.Add("$($Installer.Name).sig") | Out-Null
}

$ExtraFiles = @($ReleaseFiles | Where-Object { -not $KnownAssetNames.Contains($_.Name) })
if ($ExtraFiles.Count -gt 0) {
  Add-ValidationWarning "Arquivos extras na pasta de release: $($ExtraFiles.Name -join ', '). Confirme que nao serao anexados por engano."
}

Write-Host ""
Write-Host "Resumo:" -ForegroundColor Cyan
Write-Host "OK/AVISO/ERRO emitidos acima."
Write-Host "Erros: $($Errors.Count)"
Write-Host "Avisos: $($Warnings.Count)"

if ($Errors.Count -gt 0) {
  Write-Host ""
  Write-Host "Validacao falhou. Corrija os ERROs antes de publicar a release." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Validacao concluida com sucesso. Avisos nao bloqueiam a release, mas devem ser revisados." -ForegroundColor Green
exit 0
