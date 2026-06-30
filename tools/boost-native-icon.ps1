param(
  [string]$Project = "C:\Projetos\KPassword",
  [int]$CanvasSize = 1024,
  [double]$BoostPercent = 0.12,
  [double]$MaxFillPercent = 0.985,
  [int]$AlphaThreshold = 8
)

$ErrorActionPreference = "Stop"

$IconPath = Join-Path $Project "app-icon.png"
if (-not (Test-Path $IconPath)) {
  throw "Arquivo app-icon.png não encontrado em $Project"
}

Add-Type -AssemblyName System.Drawing

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = Join-Path $Project "app-icon.before-boost-$timestamp.png"
Copy-Item $IconPath $BackupPath -Force

$src = [System.Drawing.Bitmap]::FromFile($IconPath)

try {
  $minX = $src.Width
  $minY = $src.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
      $pixel = $src.GetPixel($x, $y)

      if ($pixel.A -gt $AlphaThreshold) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0 -or $maxY -lt 0) {
    throw "Não foi possível encontrar conteúdo visível no PNG."
  }

  $contentW = $maxX - $minX + 1
  $contentH = $maxY - $minY + 1

  $currentMax = [Math]::Max($contentW, $contentH)
  $boostedMax = [int]($currentMax * (1.0 + $BoostPercent))
  $limitMax = [int]($CanvasSize * $MaxFillPercent)
  $targetMax = [Math]::Min($boostedMax, $limitMax)

  $scale = [Math]::Min($targetMax / $contentW, $targetMax / $contentH)

  $targetW = [int]($contentW * $scale)
  $targetH = [int]($contentH * $scale)
  $targetX = [int](($CanvasSize - $targetW) / 2)
  $targetY = [int](($CanvasSize - $targetH) / 2)

  $dst = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

  try {
    $graphics = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

      $sourceRect = New-Object System.Drawing.Rectangle $minX, $minY, $contentW, $contentH
      $targetRect = New-Object System.Drawing.Rectangle $targetX, $targetY, $targetW, $targetH
      $graphics.DrawImage($src, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    }
    finally {
      $graphics.Dispose()
    }

    $TempPath = Join-Path $Project "app-icon.boosted.tmp.png"
    $dst.Save($TempPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $dst.Dispose()
  }
}
finally {
  $src.Dispose()
}

Move-Item $TempPath $IconPath -Force

$PublicDir = Join-Path $Project "public"
New-Item -ItemType Directory -Force $PublicDir | Out-Null
Copy-Item $IconPath (Join-Path $PublicDir "app-icon.png") -Force

Set-Location $Project

Write-Host ""
Write-Host "Icone nativo aumentado com sucesso." -ForegroundColor Green
Write-Host "Backup do original: $BackupPath" -ForegroundColor Yellow
Write-Host "Boost aplicado: $([int]($BoostPercent * 100))%" -ForegroundColor Cyan
Write-Host "Limite maximo do canvas: $([Math]::Round($MaxFillPercent * 100, 1))%" -ForegroundColor Cyan
Write-Host ""
Write-Host "Gerando icones nativos do Tauri..." -ForegroundColor Cyan

npm run tauri icon app-icon.png

Write-Host ""
Write-Host "Concluido." -ForegroundColor Green
