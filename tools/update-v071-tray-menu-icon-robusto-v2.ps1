param(
  [string]$Project = "C:\Projetos\KPassword",
  [double]$IconScale = 1.10
)

$ErrorActionPreference = "Stop"

$LibPath = Join-Path $Project "src-tauri\src\lib.rs"
if (-not (Test-Path $LibPath)) {
  throw "src-tauri\src\lib.rs nao encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LibBackup = "$LibPath.backup-tray-menu-v2-$timestamp"
Copy-Item $LibPath $LibBackup -Force

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$lib = [System.IO.File]::ReadAllText($LibPath, [System.Text.Encoding]::UTF8)

# 1) Helpers para abrir em tamanho completo/compacto.
if ($lib -notmatch "fn show_main_window_sized") {
  $helperLines = @(
    "",
    "fn show_main_window_sized(app: &AppHandle, width: f64, height: f64) {",
    "    if let Some(window) = app.get_webview_window(""main"") {",
    "        let _ = window.unminimize();",
    "        let _ = window.unmaximize();",
    "        let _ = window.show();",
    "        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));",
    "        let _ = window.center();",
    "        let _ = window.set_focus();",
    "    }",
    "}",
    "",
    "fn show_main_window_full(app: &AppHandle) {",
    "    show_main_window_sized(app, 1120.0, 720.0);",
    "}",
    "",
    "fn show_main_window_compact(app: &AppHandle) {",
    "    show_main_window_sized(app, 430.0, 760.0);",
    "}",
    ""
  )
  $helper = ($helperLines -join "`r`n")

  $marker = "`nfn open_folder"
  if ($lib.Contains($marker)) {
    $lib = $lib.Replace($marker, $helper + "`r`nfn open_folder")
  } else {
    throw "Nao encontrei o ponto de insercao antes de fn open_folder."
  }
}

# 2) Substitui o bloco do menu da bandeja de forma robusta.
$trayIndex = $lib.IndexOf("TrayIconBuilder::new()")
if ($trayIndex -lt 0) {
  throw "Nao encontrei TrayIconBuilder::new() no lib.rs."
}

$menuStart = $lib.LastIndexOf("let open_item", $trayIndex)
if ($menuStart -lt 0) {
  $menuStart = $lib.LastIndexOf("let open_full_item", $trayIndex)
}
if ($menuStart -lt 0) {
  throw "Nao encontrei o inicio do bloco de menu da bandeja."
}

$menuEndKey = "let menu = Menu::with_items"
$menuEnd = $lib.IndexOf($menuEndKey, $menuStart)
if ($menuEnd -lt 0 -or $menuEnd -gt $trayIndex) {
  throw "Nao encontrei a linha let menu = Menu::with_items do menu da bandeja."
}

$menuSemi = $lib.IndexOf(";", $menuEnd)
if ($menuSemi -lt 0 -or $menuSemi -gt $trayIndex) {
  throw "Nao encontrei o final do bloco do menu da bandeja."
}
$menuSemi++

$newMenuLines = @(
  "let open_full_item = MenuItem::with_id(app, ""open_full"", ""Abrir APP Completo"", true, None::<&str>)?;",
  "            let open_compact_item = MenuItem::with_id(app, ""open_compact"", ""Abrir APP Compacto"", true, None::<&str>)?;",
  "            let quit_item = MenuItem::with_id(app, ""quit"", ""Sair"", true, None::<&str>)?;",
  "            let menu = Menu::with_items(app, &[&open_full_item, &open_compact_item, &quit_item])?;"
)
$newMenu = ($newMenuLines -join "`r`n")

$lib = $lib.Substring(0, $menuStart) + $newMenu + $lib.Substring($menuSemi)

# 3) Substitui o on_menu_event inteiro ate antes do on_tray_icon_event.
$trayIndex = $lib.IndexOf("TrayIconBuilder::new()")
$eventStart = $lib.IndexOf(".on_menu_event(|app, event|", $trayIndex)
if ($eventStart -lt 0) {
  throw "Nao encontrei .on_menu_event(|app, event| no lib.rs."
}

$eventEnd = $lib.IndexOf(".on_tray_icon_event", $eventStart)
if ($eventEnd -lt 0) {
  throw "Nao encontrei .on_tray_icon_event depois do menu da bandeja."
}

$newEventLines = @(
  ".on_menu_event(|app, event| match event.id.as_ref() {",
  "                    ""open_full"" => {",
  "                        show_main_window_full(app);",
  "                    }",
  "                    ""open_compact"" => {",
  "                        show_main_window_compact(app);",
  "                    }",
  "                    ""quit"" => {",
  "                        app.exit(0);",
  "                    }",
  "                    _ => {",
  "                        println!(""Item de menu nao tratado: {:?}"", event.id);",
  "                    }",
  "                })",
  "                "
)
$newEvent = ($newEventLines -join "`r`n")

$lib = $lib.Substring(0, $eventStart) + $newEvent + $lib.Substring($eventEnd)

[System.IO.File]::WriteAllText($LibPath, $lib, $utf8NoBom)

Write-Host ""
Write-Host "Menu da bandeja atualizado com sucesso:" -ForegroundColor Green
Write-Host "- Abrir APP Completo" -ForegroundColor Cyan
Write-Host "- Abrir APP Compacto" -ForegroundColor Cyan
Write-Host "- Sair" -ForegroundColor Cyan
Write-Host "Backup do lib.rs: $LibBackup" -ForegroundColor Yellow

# 4) Aumenta levemente o conteudo do icone e regenera os icones do Tauri.
$IconPath = Join-Path $Project "app-icon.png"
if (-not (Test-Path $IconPath)) {
  $IconPath = Join-Path $Project "public\app-icon.png"
}

if (-not (Test-Path $IconPath)) {
  Write-Host ""
  Write-Host "app-icon.png nao encontrado. O menu foi ajustado, mas o icone nao foi alterado." -ForegroundColor Yellow
  exit 0
}

$RootIconPath = Join-Path $Project "app-icon.png"
$IconBackup = "$IconPath.backup-tray-scale-v2-$timestamp.png"
Copy-Item $IconPath $IconBackup -Force

Add-Type -AssemblyName System.Drawing

$bitmap = [System.Drawing.Bitmap]::new($IconPath)

try {
  $minX = $bitmap.Width
  $minY = $bitmap.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ($pixel.A -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0 -or $maxY -lt 0) {
    throw "Nao foi possivel detectar area visivel do icone."
  }

  $contentWidth = $maxX - $minX + 1
  $contentHeight = $maxY - $minY + 1

  $maxFill = 0.985
  $maxTargetWidth = [Math]::Floor($bitmap.Width * $maxFill)
  $maxTargetHeight = [Math]::Floor($bitmap.Height * $maxFill)

  $scaleByCanvas = [Math]::Min($maxTargetWidth / $contentWidth, $maxTargetHeight / $contentHeight)
  $scale = [Math]::Min($IconScale, $scaleByCanvas)

  if ($scale -le 1.001) {
    Write-Host ""
    Write-Host "O icone ja esta quase no limite do canvas. Nenhum aumento aplicado ao PNG." -ForegroundColor Yellow
  } else {
    $newWidth = [Math]::Max(1, [Math]::Round($contentWidth * $scale))
    $newHeight = [Math]::Max(1, [Math]::Round($contentHeight * $scale))
    $destX = [Math]::Round(($bitmap.Width - $newWidth) / 2)
    $destY = [Math]::Round(($bitmap.Height - $newHeight) / 2)

    $output = [System.Drawing.Bitmap]::new($bitmap.Width, $bitmap.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($output)

    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

      $srcRect = [System.Drawing.Rectangle]::new($minX, $minY, $contentWidth, $contentHeight)
      $dstRect = [System.Drawing.Rectangle]::new($destX, $destY, $newWidth, $newHeight)

      $graphics.DrawImage($bitmap, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $graphics.Dispose()
    }

    $bitmap.Dispose()
    $bitmap = $null

    $pngFormat = [System.Drawing.Imaging.ImageFormat]::Png
    $output.Save($RootIconPath, $pngFormat)
    $output.Dispose()

    $PublicDir = Join-Path $Project "public"
    New-Item -ItemType Directory -Force $PublicDir | Out-Null
    Copy-Item $RootIconPath (Join-Path $PublicDir "app-icon.png") -Force

    Write-Host ""
    Write-Host "Conteudo do icone aumentado em aproximadamente $([Math]::Round(($scale - 1) * 100, 1))%." -ForegroundColor Green
    Write-Host "Backup do icone: $IconBackup" -ForegroundColor Yellow

    Push-Location $Project
    try {
      npm run tauri icon app-icon.png
    } finally {
      Pop-Location
    }
  }
} finally {
  if ($bitmap -ne $null) {
    $bitmap.Dispose()
  }
}

Write-Host ""
Write-Host "Ajuste concluido." -ForegroundColor Green
