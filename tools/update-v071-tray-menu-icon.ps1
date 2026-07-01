param(
  [string]$Project = "C:\Projetos\KPassword",
  [double]$IconScale = 1.10
)

$ErrorActionPreference = "Stop"

$LibPath = Join-Path $Project "src-tauri\src\lib.rs"
if (-not (Test-Path $LibPath)) {
  throw "src-tauri\src\lib.rs não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LibBackup = "$LibPath.backup-tray-menu-$timestamp"
Copy-Item $LibPath $LibBackup -Force

$lib = Get-Content $LibPath -Raw -Encoding UTF8

# 1) Adiciona helpers para abrir em modo completo/compacto.
if ($lib -notmatch "fn show_main_window_sized") {
  $helper = @'

fn show_main_window_sized(app: &AppHandle, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.unmaximize();
        let _ = window.show();
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        let _ = window.center();
        let _ = window.set_focus();
    }
}

fn show_main_window_full(app: &AppHandle) {
    show_main_window_sized(app, 1120.0, 720.0);
}

fn show_main_window_compact(app: &AppHandle) {
    show_main_window_sized(app, 430.0, 760.0);
}
'@

  $needle = @'
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
'@

  if ($lib.Contains($needle)) {
    $lib = $lib.Replace($needle, $needle + $helper)
  } else {
    throw "Não encontrei a função show_main_window esperada para inserir os modos completo/compacto."
  }
}

# 2) Troca o menu da bandeja.
$oldMenu = @'
            let open_item = MenuItem::with_id(app, "open", "Abrir KPassword", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair do KPassword", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
'@

$newMenu = @'
            let open_full_item = MenuItem::with_id(app, "open_full", "Abrir APP Completo", true, None::<&str>)?;
            let open_compact_item = MenuItem::with_id(app, "open_compact", "Abrir APP Compacto", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_full_item, &open_compact_item, &quit_item])?;
'@

if ($lib.Contains($oldMenu)) {
  $lib = $lib.Replace($oldMenu, $newMenu)
} elseif ($lib -notmatch '"open_full"' -or $lib -notmatch '"open_compact"') {
  throw "Não encontrei o bloco original do menu da bandeja para substituir."
}

# 3) Troca as ações do menu.
$oldEvent = @'
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {
                        println!("Item de menu não tratado: {:?}", event.id);
                    }
                })
'@

$newEvent = @'
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_full" => {
                        show_main_window_full(app);
                    }
                    "open_compact" => {
                        show_main_window_compact(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {
                        println!("Item de menu não tratado: {:?}", event.id);
                    }
                })
'@

if ($lib.Contains($oldEvent)) {
  $lib = $lib.Replace($oldEvent, $newEvent)
} elseif ($lib -notmatch "show_main_window_full\(app\)" -or $lib -notmatch "show_main_window_compact\(app\)") {
  throw "Não encontrei o bloco original das ações do menu da bandeja para substituir."
}

Set-Content -Path $LibPath -Value $lib -Encoding UTF8

Write-Host ""
Write-Host "Menu da bandeja atualizado:" -ForegroundColor Green
Write-Host "- Abrir APP Completo" -ForegroundColor Cyan
Write-Host "- Abrir APP Compacto" -ForegroundColor Cyan
Write-Host "- Sair" -ForegroundColor Cyan
Write-Host "Backup do lib.rs: $LibBackup" -ForegroundColor Yellow

# 4) Aumenta levemente o conteúdo do ícone e regenera os ícones do Tauri.
$IconPath = Join-Path $Project "app-icon.png"
if (-not (Test-Path $IconPath)) {
  $IconPath = Join-Path $Project "public\app-icon.png"
}

if (-not (Test-Path $IconPath)) {
  Write-Host ""
  Write-Host "app-icon.png não encontrado. Menu da bandeja foi ajustado, mas o tamanho do ícone não foi alterado." -ForegroundColor Yellow
  exit 0
}

$RootIconPath = Join-Path $Project "app-icon.png"
$IconBackup = "$IconPath.backup-tray-scale-$timestamp.png"
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
    throw "Não foi possível detectar área visível do ícone."
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
    Write-Host "O ícone já está quase no limite do canvas. Nenhum aumento aplicado ao PNG." -ForegroundColor Yellow
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
    Write-Host "Conteúdo do ícone aumentado em aproximadamente $([Math]::Round(($scale - 1) * 100, 1))%." -ForegroundColor Green
    Write-Host "Backup do ícone: $IconBackup" -ForegroundColor Yellow

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
Write-Host "Ajuste concluído." -ForegroundColor Green
