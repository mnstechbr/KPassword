KPassword - corrigir build do updater v0.3.0

Corrige:
1. compareVersions declarada e não usada no App.tsx.
2. Cargo.toml com cfg inválido: windows sem target_os = "windows".
3. Evita continuar caso npm run build ou npm run tauri build falhem.
4. Gera dist-release\v0.3.0 somente se o build passar.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-updater-v030-build*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1"

Depois que passar:
- Abrir https://github.com/mnstechbr/KPassword/releases/new
- Tag: v0.3.0
- Título: KPassword v0.3.0
- Anexar os arquivos de C:\Projetos\KPassword\dist-release\v0.3.0
