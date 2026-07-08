KPassword v0.5.2 - hotfix Windows Hello no app instalado

Corrige o travamento do Windows Hello no app instalado/release.

Alterações:
- Comandos do Windows Hello no Rust agora são assíncronos.
- Operações bloqueantes do Windows Hello rodam fora do fluxo principal.
- Frontend ganhou timeout de segurança para status/ativar/desbloquear/desativar.
- Mantém fallback pela senha mestra.
- Remove warnings de nomenclatura do DATA_BLOB.
- Versão ajustada para 0.5.2.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v052-hotfix-windows-hello-release*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

Teste recomendado:
1. Testar em dev apenas para confirmar que abre.
2. Gerar instalador v0.5.2.
3. Instalar localmente o setup v0.5.2 antes de publicar no GitHub.
4. Testar ativar/desbloquear/desativar Windows Hello no app instalado.
5. Só depois publicar a release.
