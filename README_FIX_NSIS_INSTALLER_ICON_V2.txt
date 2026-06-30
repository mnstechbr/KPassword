KPassword - corrigir ícone do instalador NSIS v2

Erro corrigido:
Exceção ao definir "installerIcon": A propriedade 'installerIcon' não foi encontrada neste objeto.

Causa:
O PowerShell não permite criar propriedade nova em objeto vindo de ConvertFrom-Json usando:
$config.bundle.windows.nsis.installerIcon = "icons/icon.ico"

Correção:
O script agora usa Add-Member quando a propriedade ainda não existe.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-nsis-installer-icon-v2*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-nsis-installer-icon-v2.ps1"

npm run tauri build

Get-ChildItem ".\src-tauri\target\release\bundle\nsis" -Recurse -Include *.exe |
  Sort-Object LastWriteTime -Descending |
  Select-Object FullName, LastWriteTime

Depois:
- Abra a pasta nsis.
- Verifique o novo setup gerado.
- Se o Explorer ainda mostrar ícone antigo, clique com botão direito > Propriedades ou reinicie o Explorer/cache.
