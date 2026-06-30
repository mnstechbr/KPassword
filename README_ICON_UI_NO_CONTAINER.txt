KPassword - ícone sem container na interface

Como aplicar pelo PowerShell:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-icon-ui-no-container*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

if (Test-Path "$Project\app-icon.png") {
  New-Item -ItemType Directory -Force "$Project\public" | Out-Null
  Copy-Item "$Project\app-icon.png" "$Project\public\app-icon.png" -Force
}

npm run tauri dev

Alterações:
- Ícone da interface sem container arredondado.
- Ícone da tela de login maior.
- Ícone da barra superior maior.
- Ícone no cabeçalho do menu lateral sem moldura.
- Mantido fallback KP se public/app-icon.png não existir.

Observação:
- Essa correção altera a interface React.
- Ícone da barra de tarefas, título da janela, bandeja e instalador vem dos arquivos gerados pelo comando npm run tauri icon app-icon.png.
- Se esses ícones nativos continuarem pequenos, o arquivo app-icon.png precisa ser refeito/cortado com o desenho ocupando quase toda a área útil.
