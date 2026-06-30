KPassword v0.3.2 - idiomas globais PT/EN/ES/TR

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-idiomas-globais-v032*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project
npm run build
npm run tauri dev

O que foi adicionado:
- src/i18n.ts com PT/EN/ES/TR.
- Idioma global salvo em localStorage fora do cofre.
- Seletor de idioma na tela de login/criação/desbloqueio.
- Seletor compacto no topo do app desbloqueado.
- Card de idioma em Configurações.
- Ajustes de CSS para textos maiores e idiomas com palavras longas.
- APP_VERSION/package/tauri.conf ajustados para 0.3.2.

Depois de validar visualmente:
cd C:\Projetos\KPassword
git add .
git commit -m "Adiciona idioma global PT EN ES TR"
git push
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "0.3.2"

Depois crie a release v0.3.2 no GitHub e anexe:
- KPassword-Setup-v0.3.2.exe
- KPassword-Setup-v0.3.2.exe.sig
- latest.json
