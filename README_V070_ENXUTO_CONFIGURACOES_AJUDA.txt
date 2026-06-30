KPassword v0.7.0 - versão enxuta de produto final

Ajustes feitos após revisão honesta da primeira proposta:
- Menu principal simplificado: Cofre, Analítico, Lixeira, Segurança e Configurações.
- Remove Ajuda e Sobre do menu lateral.
- Une Ajuda e Sobre dentro de Configurações em um card curto.
- Mantém Senha mestra como termo principal.
- Troca o texto visível de Windows Hello para PIN ou biometria do computador.
- Mantém os prompts nativos funcionando, mas com texto mais compreensível.
- Dashboard mantém o card Itens salvos como botão de Mostrar detalhes.
- Mantém botões Abrir pasta do cofre e Abrir pasta de backups em Segurança.
- Mantém Exportar relatório de saúde no Analítico.
- Melhora padding da seta dos dropdowns.
- Suaviza opções selecionadas/check marks para não destoar tanto.
- Reduz informação permanente e deixa o app mais simples e objetivo.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v070-enxuto-configuracoes-ajuda*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

Teste principalmente:
1. Menu lateral com os nomes novos.
2. Configurações > Ajuda e sobre.
3. Segurança > PIN/biometria do computador.
4. Tela bloqueada > desbloqueio rápido.
5. Dropdowns de idioma, tema, cofres e validade.
6. Analítico > card Itens salvos.
7. PT / EN / ES / TR.
