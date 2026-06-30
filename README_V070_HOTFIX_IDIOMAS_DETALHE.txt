KPassword v0.7.0 - hotfix de idiomas, dropdowns e detalhe do item

Corrige:
- Select compacto de idioma com espaço excessivo entre PT e a seta.
- Opções completas de idioma traduzidas conforme o idioma atual.
  PT: Português, Inglês, Espanhol, Turco.
  EN: Portuguese, English, Spanish, Turkish.
  ES: Portugués, Inglés, Español, Turco.
  TR: Portekizce, İngilizce, İspanyolca, Türkçe.
- Aparência dos dropdowns e opção selecionada/check mark suavizadas.
- Cabeçalho do detalhe do item deixou de ser sticky/retangular.
- Conteúdo do detalhe não aparece mais passando por baixo do cabeçalho ao rolar.

Não altera:
- Cofre
- Criptografia
- Windows Hello / PIN ou biometria do computador
- TOTP
- Multi-cofres
- Backup
- Updater
- Relatório de saúde

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v070-hotfix-idiomas-detalhe*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
